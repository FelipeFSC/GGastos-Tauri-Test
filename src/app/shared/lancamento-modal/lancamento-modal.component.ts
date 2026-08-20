import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { DatabaseService, USUARIO_LOCAL_ID, EscopoEdicao } from "../../services/database.service";
import {
    CategoriaSelectComponent,
    GrupoCategoria,
} from "../categoria-select/categoria-select.component";
import {
    GrupoOrigem,
    OrigemSelectComponent,
} from "../origem-select/origem-select.component";

interface Conta {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
    ativo?: number;
}

interface Cartao {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
    ativo?: number;
}

interface Categoria {
    id: string;
    nome: string;
    tipo: string;
    icone?: string | null;
    cor?: string | null;
    categoria_pai_id?: string | null;
    ativo?: number;
}

export interface Lancamento {
    id: string;
    usuario_id?: string;
    descricao: string;
    valor: number;
    data: string;
    tipo: string;
    conta_id: string | null;
    cartao_id: string | null;
    categoria_id: string | null;
    confirmado: number;
    parcela_atual: number | null;
    parcela_total: number | null;
    fatura_id?: string | null;
    fixo?: number;
    frequencia?: string | null;
    grupo_parcelamento_id?: string | null;
    observacao?: string | null;
}

export interface TagRef {
    id: string;
    nome: string;
    ativo?: number;
}

export interface AnexoExistente {
    id: string;
    nome: string;
    tamanho: number;
}

interface AnexoForm {
    nome: string;
    tamanho: number;
    arquivo: File;
}

/** Uma "parte" da divisão — vira um lançamento do tipo oposto (quem te paga de volta). */
interface PessoaDivisao {
    id: string;
    nome: string;
    valor: string;
    confirmado: boolean;
}

interface FormLancamento {
    descricao: string;
    valor: string;
    data: string;

    origem: string;
    categoria_id: string;

    confirmado: boolean;

    observacao: string;

    tipoRepeticao: "fixa" | "parcelada";
    frequencia: string;
    quantidadeParcelas: number;

    tagIds: string[];
    anexos: AnexoForm[];
}

/**
 * Pop-up padrão de criar/editar lançamento (receita ou despesa), com
 * repetição fixa/parcelada, tags e anexos.
 *
 * Compartilhado entre a tela de Lançamentos e a tela de Fatura — quem usa
 * chama abrirNovo()/abrirEdicao() via referência de template (#modal) e
 * escuta (salvo) pra recarregar a própria listagem.
 */
@Component({
    selector: "app-lancamento-modal",
    standalone: true,
    imports: [CommonModule, FormsModule, CategoriaSelectComponent, OrigemSelectComponent],
    templateUrl: "./lancamento-modal.component.html",
    styleUrl: "./lancamento-modal.component.css",
})
export class LancamentoModalComponent implements OnInit {
    /** Quando setado, trava a origem (conta/cartão) do lançamento nesse valor. */
    @Input() origemFixa: { tipo: "conta" | "cartao"; id: string } | null = null;

    /** Data padrão pro novo lançamento (em vez de hoje). */
    @Input() dataSugerida: string | null = null;

    /** Emitido quando um lançamento é criado/editado com sucesso. */
    @Output() salvo = new EventEmitter<void>();

    /** Emitido quando o lançamento em edição é excluído. */
    @Output() excluido = new EventEmitter<void>();

    contas: Conta[] = [];
    cartoes: Cartao[] = [];
    categorias: Categoria[] = [];

    modalAberto = false;
    tipoModal: "receita" | "despesa" | null = null;

    /*
     * ID do lançamento que está sendo editado.
     *
     * null = criação de novo lançamento
     * string = edição
     */
    editarId: string | null = null;

    /** Cartão do lançamento antes da edição (null se não for cartão ou for criação nova). */
    cartaoIdOriginal: string | null = null;

    /** Valor do lançamento antes da edição, usado pra calcular o impacto no limite do cartão. */
    private valorOriginal = 0;

    /**
     * true quando o lançamento em edição pertence a um grupo de repetição
     * (fixo ou parcelado). Nesse caso o tipo de repetição fica travado e
     * aparecem as opções de escopo (todos / atual e próximos / atual).
     */
    editandoGrupo = false;
    tipoRepeticaoOriginal: "fixa" | "parcelada" | null = null;
    escopoEdicao: "atual" | "atual_e_proximos" | "todos" = "atual";

    salvando = false;
    excluindo = false;

    /** Tags cadastradas no CRUD de tags, usadas para popular o select. */
    tagsDisponiveis: TagRef[] = [];
    /** Tag selecionada no <select> antes de clicar em "adicionar". */
    novaTagId = "";

    /** Anexos já salvos no banco do lançamento em edição (distintos dos arquivos recém-selecionados em form.anexos). */
    anexosExistentes: AnexoExistente[] = [];

    opcoes = {
        repetir: false,
        observacao: false,
        anexo: false,
        tags: false,
        dividir: false,
    };

    /**
     * "Dividir": você já pagou o valor total, e cada pessoa aqui é a
     * parte que ela vai te devolver — vira um lançamento do tipo oposto
     * ao do lançamento principal (despesa → receita, ou o contrário),
     * sempre numa conta (nunca cartão) e numa categoria à parte. "Eu" não
     * é um lançamento, é só a diferença (total - soma das pessoas),
     * mostrada pra referência.
     */
    pessoasDivisao: PessoaDivisao[] = [];
    categoriaDivisaoId = "";
    contaDivisaoId = "";

    frequencias = [
        { valor: "diario", nome: "Diário" },
        { valor: "semanal", nome: "Semanal" },
        { valor: "quinzenal", nome: "Quinzenal" },
        { valor: "mensal", nome: "Mensal" },
        { valor: "bimestral", nome: "Bimestral" },
        { valor: "trimestral", nome: "Trimestral" },
        { valor: "semestral", nome: "Semestral" },
        { valor: "anual", nome: "Anual" },
    ];

    form: FormLancamento = this.criarFormulario();

    constructor(private db: DatabaseService) { }

    async ngOnInit(): Promise<void> {
        this.contas = await this.db.query<Conta>(
            `SELECT * FROM contas WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );

        this.cartoes = await this.db.query<Cartao>(
            `SELECT * FROM cartoes_credito WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );

        this.categorias = await this.db.query<Categoria>(
            `SELECT * FROM categorias WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );

        this.tagsDisponiveis = await this.db.query<TagRef>(
            `SELECT id, nome, ativo FROM tags WHERE usuario_id = ? ORDER BY nome`,
            [USUARIO_LOCAL_ID],
        );
    }

    // =====================================================================
    // FORMULÁRIO
    // =====================================================================

    private criarFormulario(): FormLancamento {
        return {
            descricao: "",
            valor: "",
            data: this.dataSugerida || this.obterDataAtual(),

            origem: this.origemFixa ? `${this.origemFixa.tipo}:${this.origemFixa.id}` : "",
            categoria_id: "",

            confirmado: false,

            observacao: "",

            tipoRepeticao: "fixa",
            frequencia: "mensal",
            quantidadeParcelas: 2,

            tagIds: [],
            anexos: [],
        };
    }

    private obterDataAtual(): string {
        const hoje = new Date();

        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, "0");
        const dia = String(hoje.getDate()).padStart(2, "0");

        return `${ano}-${mes}-${dia}`;
    }

    // =====================================================================
    // MODAL
    // =====================================================================

    abrirNovo(tipo: "receita" | "despesa"): void {
        this.tipoModal = tipo;

        this.editarId = null;
        this.cartaoIdOriginal = null;
        this.valorOriginal = 0;
        this.editandoGrupo = false;
        this.tipoRepeticaoOriginal = null;
        this.escopoEdicao = "atual";

        this.form = this.criarFormulario();

        this.opcoes = {
            repetir: false,
            observacao: false,
            anexo: false,
            tags: false,
            dividir: false,
        };

        this.limparDivisao();

        this.novaTagId = "";
        this.anexosExistentes = [];

        this.modalAberto = true;
    }

    /*
     * Abre o mesmo modal utilizado para criação,
     * porém preenchendo os dados do lançamento existente.
     */
    async abrirEdicao(lancamento: Lancamento): Promise<void> {
        this.editarId = lancamento.id;
        this.cartaoIdOriginal = lancamento.cartao_id;
        this.valorOriginal = lancamento.valor;

        this.tipoModal = lancamento.tipo === "receita" ? "receita" : "despesa";

        /*
         * Descobre qual é a origem atual.
         */
        let origem = "";

        if (lancamento.conta_id) {
            origem = `conta:${lancamento.conta_id}`;
        } else if (lancamento.cartao_id) {
            origem = `cartao:${lancamento.cartao_id}`;
        }

        /*
         * Preenche o formulário.
         */
        this.form = this.criarFormulario();

        this.form.descricao = lancamento.descricao;

        this.form.valor = this.valorFormatado(lancamento.valor);

        this.form.data = lancamento.data;

        this.form.origem = origem;

        this.form.categoria_id = lancamento.categoria_id || "";

        this.form.confirmado = lancamento.confirmado === 1;

        this.form.observacao = lancamento.observacao || "";

        /*
         * Se o lançamento pertence a um grupo (fixo ou parcelado), o tipo
         * de repetição fica travado — o usuário só pode ajustar a
         * frequência (fixo) ou a quantidade de parcelas (parcelado), e
         * escolher em quais ocorrências a mudança se aplica.
         *
         * Se for único, escondemos a opção de repetir por completo:
         * o que é único vai continuar único.
         */
        this.editandoGrupo = !!lancamento.grupo_parcelamento_id;
        this.escopoEdicao = "atual";

        if (this.editandoGrupo) {
            this.tipoRepeticaoOriginal = lancamento.fixo === 1 ? "fixa" : "parcelada";

            this.form.tipoRepeticao = this.tipoRepeticaoOriginal;
            this.form.frequencia = lancamento.frequencia || "mensal";
            this.form.quantidadeParcelas = lancamento.parcela_total || 2;

            this.opcoes = {
                repetir: true,
                observacao: false,
                anexo: false,
                tags: false,
                dividir: false,
            };
        } else {
            this.tipoRepeticaoOriginal = null;

            this.opcoes = {
                repetir: false,
                observacao: false,
                anexo: false,
                tags: false,
                dividir: false,
            };
        }

        // "Dividir" é só pra lançamento novo — edição nunca abre com isso.
        this.limparDivisao();

        this.novaTagId = "";

        /*
         * Observação, tags e anexos são sempre carregados do banco, e o
         * painel correspondente já abre visível se houver algo salvo —
         * assim o usuário enxerga de cara o que o lançamento já tem.
         */
        this.form.observacao = lancamento.observacao || "";
        this.opcoes.observacao = !!lancamento.observacao;

        const tags = await this.db.obterTagsDoLancamento(lancamento.id);
        this.form.tagIds = tags.map((t) => t.id);
        this.opcoes.tags = tags.length > 0;

        this.anexosExistentes = await this.db.listarAnexos(lancamento.id);
        this.opcoes.anexo = this.anexosExistentes.length > 0;

        this.modalAberto = true;
    }

    fecharModal(): void {
        this.modalAberto = false;
        this.tipoModal = null;

        /*
         * Muito importante:
         * ao fechar o modal, saímos do modo de edição.
         */
        this.editarId = null;
        this.cartaoIdOriginal = null;
        this.editandoGrupo = false;
        this.tipoRepeticaoOriginal = null;
        this.escopoEdicao = "atual";

        this.limparDivisao();

        this.salvando = false;
    }

    alternarOpcao(opcao: "repetir" | "observacao" | "anexo" | "tags" | "dividir"): void {
        /*
         * Durante edição, "repetir" e "dividir" nunca são alternáveis por
         * clique: lançamento único não vira repetição/divisão, e
         * lançamento de grupo já fica sempre com o painel de repetição
         * aberto (travado).
         */
        if (this.editarId && (opcao === "repetir" || opcao === "dividir")) {
            return;
        }

        this.opcoes[opcao] = !this.opcoes[opcao];

        if (!this.opcoes.tags) {
            this.form.tagIds = [];
            this.novaTagId = "";
        }

        if (!this.opcoes.anexo) {
            this.form.anexos = [];
        }

        if (!this.opcoes.observacao) {
            this.form.observacao = "";
        }

        if (!this.opcoes.repetir) {
            this.form.tipoRepeticao = "fixa";
            this.form.frequencia = "mensal";
            this.form.quantidadeParcelas = 2;
        }

        /*
         * Repetir e Dividir são mutuamente exclusivos — ligar um desliga
         * o outro (e limpa o que já tinha sido preenchido nele).
         */
        if (opcao === "repetir" && this.opcoes.repetir && this.opcoes.dividir) {
            this.opcoes.dividir = false;
            this.limparDivisao();
        }

        if (opcao === "dividir") {
            if (this.opcoes.dividir && this.opcoes.repetir) {
                this.opcoes.repetir = false;
                this.form.tipoRepeticao = "fixa";
                this.form.frequencia = "mensal";
                this.form.quantidadeParcelas = 2;
            }

            if (!this.opcoes.dividir) {
                this.limparDivisao();
            }
        }
    }

    // =====================================================================
    // CATEGORIAS
    // =====================================================================

    /** Ativa, ou é a categoria já atribuída a este lançamento (edição de item antigo). */
    private categoriaSelecionavel(categoria: Categoria): boolean {
        return categoria.ativo !== 0 || categoria.id === this.form.categoria_id;
    }

    /** Só do tipo do lançamento atual (despesa não mistura com categoria de receita e vice-versa). */
    get categoriasPrincipais(): Categoria[] {
        const categoriaSelecionada = this.categorias.find(
            (categoria) => categoria.id === this.form.categoria_id,
        );

        const paiDaSelecionada = categoriaSelecionada?.categoria_pai_id;

        return this.categorias.filter(
            (categoria) =>
                !categoria.categoria_pai_id &&
                categoria.tipo === this.tipoModal &&
                (this.categoriaSelecionavel(categoria) || categoria.id === paiDaSelecionada),
        );
    }

    subcategoriasDa(categoriaId: string): Categoria[] {
        return this.categorias.filter(
            (categoria) =>
                categoria.categoria_pai_id === categoriaId &&
                this.categoriaSelecionavel(categoria),
        );
    }

    /** Categorias principais + subcategorias já agrupadas, prontas pro <app-categoria-select>. */
    get gruposCategorias(): GrupoCategoria[] {
        return this.categoriasPrincipais.map((principal) => ({
            principal,
            subcategorias: this.subcategoriasDa(principal.id),
        }));
    }

    // =====================================================================
    // ORIGEM
    // =====================================================================

    /** Contas ativas, mais a conta já atribuída a este lançamento (edição de item antigo). */
    get contasSelecionaveis(): Conta[] {
        return this.contas.filter(
            (conta) => conta.ativo !== 0 || this.form.origem === `conta:${conta.id}`,
        );
    }

    /** Cartões ativos, mais o cartão já atribuído a este lançamento (edição de item antigo). */
    get cartoesSelecionaveis(): Cartao[] {
        return this.cartoes.filter(
            (cartao) => cartao.ativo !== 0 || this.form.origem === `cartao:${cartao.id}`,
        );
    }

    /** Contas + cartões já agrupados, prontos pro <app-origem-select>. */
    get gruposOrigem(): GrupoOrigem[] {
        return [
            {
                rotulo: "Contas",
                prefixo: "conta",
                iconePadrao: "account_balance_wallet",
                itens: this.contasSelecionaveis,
            },
            {
                rotulo: "Cartões",
                prefixo: "cartao",
                iconePadrao: "credit_card",
                itens: this.cartoesSelecionaveis,
            },
        ];
    }

    private processarOrigem(): {
        conta_id: string | null;
        cartao_id: string | null;
    } {
        if (!this.form.origem) {
            return {
                conta_id: null,
                cartao_id: null,
            };
        }

        const partes = this.form.origem.split(":");

        const tipo = partes[0];
        const id = partes.slice(1).join(":");

        if (!id) {
            return {
                conta_id: null,
                cartao_id: null,
            };
        }

        if (tipo === "conta") {
            return {
                conta_id: id,
                cartao_id: null,
            };
        }

        if (tipo === "cartao") {
            return {
                conta_id: null,
                cartao_id: id,
            };
        }

        return {
            conta_id: null,
            cartao_id: null,
        };
    }

    // =====================================================================
    // DIVIDIR
    // =====================================================================

    /** Tipo oposto ao do lançamento principal — é o tipo de cada "parte" da divisão. */
    get tipoOposto(): "receita" | "despesa" {
        return this.tipoModal === "despesa" ? "receita" : "despesa";
    }

    /** Soma do que já foi preenchido pras pessoas. */
    get somaPessoasDivisao(): number {
        return this.pessoasDivisao.reduce(
            (soma, pessoa) => soma + this.parseValorTexto(pessoa.valor),
            0,
        );
    }

    /** O que sobra pra "Eu" — não é um lançamento, é só o valor mostrado pra referência. */
    get euDivisao(): number {
        return Math.round((this.valorNumerico() - this.somaPessoasDivisao) * 100) / 100;
    }

    get divisaoExcedeTotal(): boolean {
        return this.somaPessoasDivisao > this.valorNumerico() + 0.001;
    }

    private limparDivisao(): void {
        this.pessoasDivisao = [];
        this.categoriaDivisaoId = "";
        this.contaDivisaoId = "";
    }

    /** Nova pessoa já entra com metade do que hoje sobra pro "Eu" — o usuário ajusta depois se quiser. */
    adicionarPessoaDivisao(): void {
        const restante = Math.max(this.euDivisao, 0);
        const metade = Math.floor((restante / 2) * 100) / 100;

        this.pessoasDivisao.push({
            id: this.gerarId(),
            nome: "",
            valor: this.valorFormatado(metade),
            confirmado: false,
        });
    }

    removerPessoaDivisao(id: string): void {
        this.pessoasDivisao = this.pessoasDivisao.filter((pessoa) => pessoa.id !== id);
    }

    /** Reseta todo mundo pra uma divisão igual do total (Eu incluído — o que sobra de arredondamento fica com o "Eu"). */
    recalcularDivisao(): void {
        const quantidade = this.pessoasDivisao.length + 1;

        if (quantidade < 2) {
            return;
        }

        const base = Math.floor((this.valorNumerico() / quantidade) * 100) / 100;

        for (const pessoa of this.pessoasDivisao) {
            pessoa.valor = this.valorFormatado(base);
        }
    }

    /** Ativa, ou é a categoria já escolhida pra divisão. */
    private categoriaSelecionavelDivisao(categoria: Categoria): boolean {
        return categoria.ativo !== 0 || categoria.id === this.categoriaDivisaoId;
    }

    get categoriasPrincipaisDivisao(): Categoria[] {
        const categoriaSelecionada = this.categorias.find(
            (categoria) => categoria.id === this.categoriaDivisaoId,
        );

        const paiDaSelecionada = categoriaSelecionada?.categoria_pai_id;

        return this.categorias.filter(
            (categoria) =>
                !categoria.categoria_pai_id &&
                categoria.tipo === this.tipoOposto &&
                (this.categoriaSelecionavelDivisao(categoria) || categoria.id === paiDaSelecionada),
        );
    }

    subcategoriasDaDivisao(categoriaId: string): Categoria[] {
        return this.categorias.filter(
            (categoria) =>
                categoria.categoria_pai_id === categoriaId &&
                this.categoriaSelecionavelDivisao(categoria),
        );
    }

    get gruposCategoriasDivisao(): GrupoCategoria[] {
        return this.categoriasPrincipaisDivisao.map((principal) => ({
            principal,
            subcategorias: this.subcategoriasDaDivisao(principal.id),
        }));
    }

    /** Só contas (nunca cartão — quem te paga de volta cai numa conta, não "credita" um cartão). */
    get contasDivisaoSelecionaveis(): Conta[] {
        return this.contas.filter(
            (conta) => conta.ativo !== 0 || conta.id === this.contaDivisaoId,
        );
    }

    // =====================================================================
    // VALORES
    // =====================================================================

    valorFormatado(valor: number): string {
        return valor.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    private parseValorTexto(texto: string): number {
        const valor = String(texto || "")
            .replace(/\s/g, "")
            .replace(/\./g, "")
            .replace(",", ".");

        const numero = Number(valor);

        return Number.isFinite(numero) ? numero : 0;
    }

    valorNumerico(): number {
        return this.parseValorTexto(this.form.valor);
    }

    valorParcela(): number {
        const quantidade = Number(this.form.quantidadeParcelas);

        if (quantidade < 2 || !Number.isFinite(quantidade)) {
            return this.valorNumerico();
        }

        return Math.floor((this.valorNumerico() / quantidade) * 100) / 100;
    }

    valorParcelaFormatado(): string {
        const valorTotal = this.valorNumerico();

        const quantidade = Number(this.form.quantidadeParcelas);

        if (quantidade < 2 || valorTotal <= 0) {
            return "0,00";
        }

        return this.valorFormatado(this.valorParcela());
    }

    // =====================================================================
    // TAGS
    // =====================================================================

    adicionarTagSelecionada(): void {
        if (!this.opcoes.tags || !this.novaTagId) {
            return;
        }

        if (!this.form.tagIds.includes(this.novaTagId)) {
            this.form.tagIds.push(this.novaTagId);
        }

        this.novaTagId = "";
    }

    removerTag(index: number): void {
        if (index < 0 || index >= this.form.tagIds.length) {
            return;
        }

        this.form.tagIds.splice(index, 1);
    }

    /** Nome da tag pelo id, pra exibir os "chips" selecionados no formulário. */
    nomeTag(tagId: string): string {
        return this.tagsDisponiveis.find((t) => t.id === tagId)?.nome ?? "-";
    }

    /**
     * Tags ainda não selecionadas nesse lançamento — é o que aparece
     * disponível no <select>, pra não deixar escolher a mesma duas vezes.
     */
    get tagsParaSelecionar(): TagRef[] {
        return this.tagsDisponiveis.filter(
            (t) => t.ativo !== 0 && !this.form.tagIds.includes(t.id),
        );
    }

    // =====================================================================
    // ANEXOS
    // =====================================================================

    adicionarAnexos(event: Event): void {
        if (!this.opcoes.anexo) {
            return;
        }

        const input = event.target as HTMLInputElement;

        if (!input.files) {
            return;
        }

        for (const arquivo of Array.from(input.files)) {
            this.form.anexos.push({
                nome: arquivo.name,
                tamanho: arquivo.size,
                arquivo,
            });
        }

        input.value = "";
    }

    removerAnexo(index: number): void {
        if (index < 0 || index >= this.form.anexos.length) {
            return;
        }

        this.form.anexos.splice(index, 1);
    }

    /**
     * Remove um anexo que já estava salvo no banco (edição de lançamento
     * existente). Remove na hora, não espera o "Salvar" do modal.
     */
    async removerAnexoExistente(anexoId: string): Promise<void> {
        await this.db.removerAnexo(anexoId);

        this.anexosExistentes = this.anexosExistentes.filter(
            (anexo) => anexo.id !== anexoId,
        );
    }

    /**
     * Lê um File selecionado pelo usuário e devolve o conteúdo em base64
     * (sem o prefixo "data:tipo;base64,"), pronto pra salvar no banco.
     */
    private lerArquivoComoBase64(arquivo: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const leitor = new FileReader();

            leitor.onload = () => {
                const resultado = leitor.result as string;
                const base64 = resultado.includes(",")
                    ? resultado.split(",")[1]
                    : resultado;
                resolve(base64);
            };

            leitor.onerror = () => reject(leitor.error);

            leitor.readAsDataURL(arquivo);
        });
    }

    /**
     * Salva no banco todos os arquivos pendentes (form.anexos) de um
     * lançamento já inserido, e limpa a lista de pendentes.
     */
    private async salvarAnexosPendentes(lancamentoId: string): Promise<void> {
        for (const anexo of this.form.anexos) {
            const conteudo = await this.lerArquivoComoBase64(anexo.arquivo);

            await this.db.adicionarAnexo(
                lancamentoId,
                anexo.nome,
                anexo.arquivo.type || "application/octet-stream",
                anexo.tamanho,
                conteudo,
            );
        }
    }

    tamanhoArquivo(tamanho: number): string {
        if (tamanho < 1024) {
            return `${tamanho} B`;
        }

        if (tamanho < 1024 * 1024) {
            return `${(tamanho / 1024).toFixed(1)} KB`;
        }

        return `${(tamanho / (1024 * 1024)).toFixed(1)} MB`;
    }

    // =====================================================================
    // DATAS
    // =====================================================================

    private gerarId(): string {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
            return crypto.randomUUID();
        }

        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }

    private adicionarIntervalo(data: string, frequencia: string): string {
        const [ano, mes, dia] = data.split("-").map(Number);

        let mesesAdicionar = 0;

        switch (frequencia) {
            case "diario":
                return this.formatarDataISO(new Date(ano, mes - 1, dia + 1));

            case "semanal":
                return this.formatarDataISO(new Date(ano, mes - 1, dia + 7));

            case "quinzenal":
                return this.formatarDataISO(new Date(ano, mes - 1, dia + 15));

            case "mensal":
                mesesAdicionar = 1;
                break;

            case "bimestral":
                mesesAdicionar = 2;
                break;

            case "trimestral":
                mesesAdicionar = 3;
                break;

            case "semestral":
                mesesAdicionar = 6;
                break;

            case "anual":
                mesesAdicionar = 12;
                break;

            default:
                return data;
        }

        const novaData = new Date(ano, mes - 1, 1);

        novaData.setMonth(novaData.getMonth() + mesesAdicionar);

        const ultimoDiaDoMes = new Date(
            novaData.getFullYear(),
            novaData.getMonth() + 1,
            0,
        ).getDate();

        novaData.setDate(Math.min(dia, ultimoDiaDoMes));

        return this.formatarDataISO(novaData);
    }

    private formatarDataISO(data: Date): string {
        const ano = data.getFullYear();

        const mes = String(data.getMonth() + 1).padStart(2, "0");

        const dia = String(data.getDate()).padStart(2, "0");

        return `${ano}-${mes}-${dia}`;
    }

    private obterFimDoAno(dataInicial: string): string {
        const [ano] = dataInicial.split("-").map(Number);

        return `${ano}-12-31`;
    }

    // =====================================================================
    // LIMITE DO CARTÃO
    // =====================================================================

    /**
     * Avisa (sem bloquear) quando a despesa vai deixar o cartão estourado.
     *
     * Numa edição do mesmo cartão, considera só o acréscimo em relação ao
     * valor original — o valor antigo já está contado no limite disponível
     * atual, então só o que passar disso é que estoura de fato.
     */
    private async confirmarLimiteCartao(
        cartaoId: string,
        valor: number,
    ): Promise<boolean> {
        const disponivel = await this.db.obterLimiteDisponivelCartao(cartaoId);

        const acrescimo =
            this.editarId && this.cartaoIdOriginal === cartaoId
                ? valor - this.valorOriginal
                : valor;

        if (acrescimo <= disponivel) {
            return true;
        }

        const cartao = this.cartoes.find((item) => item.id === cartaoId);

        return confirm(
            `Essa despesa vai exceder o limite disponível do cartão${cartao ? ` "${cartao.nome}"` : ""
            } em R$ ${this.valorFormatado(acrescimo - disponivel)}. Deseja continuar mesmo assim?`,
        );
    }

    // =====================================================================
    // SALVAMENTO
    // =====================================================================

    async salvarLancamento(): Promise<void> {
        if (this.salvando) {
            return;
        }

        if (!this.tipoModal) {
            return;
        }

        const descricao = this.form.descricao.trim();

        const valor = this.valorNumerico();

        if (valor <= 0) {
            alert("Informe um valor válido.");
            return;
        }

        if (!this.form.data) {
            alert("Informe a data do lançamento.");
            return;
        }

        if (!this.form.origem) {
            alert("Selecione uma conta ou cartão.");
            return;
        }

        if (!this.form.categoria_id) {
            alert("Selecione uma categoria.");
            return;
        }

        if (this.opcoes.dividir && this.pessoasDivisao.length > 0) {
            for (const pessoa of this.pessoasDivisao) {
                if (!pessoa.nome.trim()) {
                    alert("Informe o nome de todas as pessoas na divisão.");
                    return;
                }

                if (this.parseValorTexto(pessoa.valor) <= 0) {
                    alert(`Informe um valor válido para "${pessoa.nome}".`);
                    return;
                }
            }

            if (this.divisaoExcedeTotal) {
                alert(
                    `A soma das partes (R$ ${this.valorFormatado(this.somaPessoasDivisao)}) não pode passar do valor total (R$ ${this.valorFormatado(valor)}).`,
                );
                return;
            }

            if (!this.contaDivisaoId) {
                alert("Selecione em qual conta você vai receber a parte de cada pessoa.");
                return;
            }

            if (!this.categoriaDivisaoId) {
                alert(`Selecione a categoria de ${this.tipoOposto} pra essas partes.`);
                return;
            }
        }

        this.salvando = true;

        try {
            const origem = this.processarOrigem();

            if (this.tipoModal === "despesa" && origem.cartao_id) {
                const prosseguir = await this.confirmarLimiteCartao(
                    origem.cartao_id,
                    valor,
                );

                if (!prosseguir) {
                    this.salvando = false;
                    return;
                }
            }

            /*
             * ================================================================
             * EDIÇÃO
             * ================================================================
             *
             * Se existir editarId, atualizamos somente o lançamento
             * selecionado.
             *
             * O fluxo de repetição não é executado.
             */
            if (this.editarId) {
                await this.db.atualizarLancamentoComEscopo(
                    this.editarId,
                    {
                        descricao,
                        valor,
                        data: this.form.data,
                        conta_id: origem.conta_id,
                        cartao_id: origem.cartao_id,
                        categoria_id: this.form.categoria_id || null,
                        confirmado: this.form.confirmado,
                        frequencia:
                            this.editandoGrupo && this.form.tipoRepeticao === "fixa"
                                ? (this.form.frequencia as any)
                                : undefined,
                        parcela_total:
                            this.editandoGrupo && this.form.tipoRepeticao === "parcelada"
                                ? Number(this.form.quantidadeParcelas)
                                : undefined,
                    },
                    this.editandoGrupo ? this.escopoEdicao : "atual",
                );

                /*
                 * Observação, tags e anexos são sempre por ocorrência (não
                 * seguem o escopo "todos"/"atual e próximos"). Só conseguimos
                 * salvar direto no id original quando o escopo é "atual": nos
                 * outros dois, o método acima apaga e recria as linhas com
                 * ids novos, então não teria em qual id gravar aqui.
                 */
                const escopoUsado = this.editandoGrupo ? this.escopoEdicao : "atual";

                if (escopoUsado === "atual") {
                    await this.db.salvarObservacao(
                        this.editarId,
                        this.form.observacao.trim() || null,
                    );

                    await this.db.salvarTagsDoLancamento(this.editarId, this.form.tagIds);

                    await this.salvarAnexosPendentes(this.editarId);
                }

                await this.verificarFaturasEnvolvidas([
                    this.cartaoIdOriginal,
                    origem.cartao_id,
                ]);

                this.salvo.emit();

                this.fecharModal();

                return;
            }

            /*
             * ================================================================
             * CRIAÇÃO
             * ================================================================
             */

            if (this.opcoes.repetir && this.form.tipoRepeticao === "parcelada") {
                const quantidade = Number(this.form.quantidadeParcelas);

                if (!Number.isInteger(quantidade) || quantidade < 2) {
                    alert("Informe pelo menos 2 parcelas.");

                    this.salvando = false;

                    return;
                }
            }

            /*
             * REPETIÇÃO DESATIVADA
             */
            if (!this.opcoes.repetir) {
                await this.inserirLancamento({
                    id: this.gerarId(),
                    descricao,
                    valor,
                    data: this.form.data,
                    tipo: this.tipoModal,
                    conta_id: origem.conta_id,
                    cartao_id: origem.cartao_id,
                    categoria_id: this.form.categoria_id || null,
                    confirmado: this.form.confirmado ? 1 : 0,
                    parcela_atual: null,
                    parcela_total: null,
                });

                if (this.opcoes.dividir && this.pessoasDivisao.length > 0) {
                    await this.criarLancamentosDivisao(descricao, this.form.data);
                }
            } else if (this.form.tipoRepeticao === "parcelada") {

                /*
                 * REPETIÇÃO PARCELADA
                 */
                await this.salvarParcelamento(descricao, valor, origem);
            } else {

                /*
                 * REPETIÇÃO FIXA
                 */
                await this.salvarLancamentoFixo(descricao, valor, origem);
            }

            await this.verificarFaturasEnvolvidas([origem.cartao_id]);

            this.salvo.emit();

            this.fecharModal();
        } catch (erro) {
            console.error("Erro ao salvar lançamento:", erro);

            alert("Não foi possível salvar o lançamento.");
        } finally {
            this.salvando = false;
        }
    }

    /**
     * Roda a verificação de faturas (ver `DatabaseService.verificarFaturasDoCartao`)
     * pros cartões afetados por uma criação/edição/exclusão de lançamento —
     * o cartão atual do lançamento e, numa edição, também o cartão anterior
     * (caso a origem tenha mudado de cartão pra outro cartão/conta).
     */
    private async verificarFaturasEnvolvidas(
        cartaoIds: (string | null | undefined)[],
    ): Promise<void> {
        const unicos = Array.from(
            new Set(cartaoIds.filter((id): id is string => !!id)),
        );

        for (const cartaoId of unicos) {
            await this.db.verificarFaturasDoCartao(cartaoId);
        }
    }

    // =====================================================================
    // EXCLUSÃO
    // =====================================================================

    /**
     * Exclui o lançamento em edição. Se ele pertencer a um grupo (fixo ou
     * parcelado), reaproveita o mesmo escopo já selecionado no painel
     * "Aplicar alteração em" — não abre um segundo pop-up perguntando de
     * novo o que excluir.
     */
    async excluirLancamento(): Promise<void> {
        if (!this.editarId || this.salvando || this.excluindo) {
            return;
        }

        if (!confirm("Tem certeza que deseja excluir este lançamento?")) {
            return;
        }

        this.excluindo = true;

        try {
            await this.db.excluirLancamentoComEscopo(
                this.editarId,
                this.editandoGrupo ? this.escopoEdicao : ("atual" as EscopoEdicao),
            );

            await this.verificarFaturasEnvolvidas([this.cartaoIdOriginal]);

            this.excluido.emit();

            this.fecharModal();
        } catch (erro) {
            console.error("Erro ao excluir lançamento:", erro);

            alert("Não foi possível excluir o lançamento.");
        } finally {
            this.excluindo = false;
        }
    }

    // =====================================================================
    // INSERÇÃO
    // =====================================================================

    private async inserirLancamento(lancamento: {
        id: string;
        descricao: string;
        valor: number;
        data: string;
        tipo: "receita" | "despesa";
        conta_id: string | null;
        cartao_id: string | null;
        categoria_id: string | null;
        confirmado: number;
        parcela_atual: number | null;
        parcela_total: number | null;
    }): Promise<void> {
        let faturaId: string | null = null;

        if (lancamento.cartao_id) {
            const fatura = await this.db.obterOuCriarFatura(
                lancamento.cartao_id,
                lancamento.data,
            );

            faturaId = fatura.id;
        }

        await this.db.run(
            `INSERT INTO lancamentos (
        id,
        usuario_id,
        descricao,
        valor,
        data,
        tipo,
        conta_id,
        cartao_id,
        fatura_id,
        categoria_id,
        confirmado,
        fixo,
        frequencia,
        parcela_atual,
        parcela_total,
        grupo_parcelamento_id,
        observacao
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                lancamento.id,
                USUARIO_LOCAL_ID,
                lancamento.descricao,
                lancamento.valor,
                lancamento.data,
                lancamento.tipo,
                lancamento.conta_id,
                lancamento.cartao_id,
                faturaId,
                lancamento.categoria_id,
                lancamento.confirmado,
                0,
                null,
                lancamento.parcela_atual,
                lancamento.parcela_total,
                null,
                this.form.observacao.trim() || null,
            ],
        );

        if (this.form.tagIds.length) {
            await this.db.salvarTagsDoLancamento(lancamento.id, this.form.tagIds);
        }

        await this.salvarAnexosPendentes(lancamento.id);
    }

    // =====================================================================
    // DIVIDIR — INSERÇÃO
    // =====================================================================

    /**
     * Uma linha por pessoa, cada uma um lançamento independente (sem
     * grupo_parcelamento_id nenhum — não seguem o lançamento principal
     * em edições/exclusões futuras, de propósito, pra não complicar o
     * fluxo de escopo que já existe pro Repetir).
     */
    private async criarLancamentosDivisao(descricaoPrincipal: string, data: string): Promise<void> {
        for (const pessoa of this.pessoasDivisao) {
            await this.inserirLancamentoSimples({
                id: this.gerarId(),
                descricao: `${descricaoPrincipal} - ${pessoa.nome.trim()}`,
                valor: this.parseValorTexto(pessoa.valor),
                data,
                tipo: this.tipoOposto,
                conta_id: this.contaDivisaoId,
                categoria_id: this.categoriaDivisaoId,
                confirmado: pessoa.confirmado ? 1 : 0,
            });
        }
    }

    /** INSERT enxuto — sem observação/tags/anexos (isso fica só no lançamento principal) e sem cartão (sempre conta). */
    private async inserirLancamentoSimples(lancamento: {
        id: string;
        descricao: string;
        valor: number;
        data: string;
        tipo: "receita" | "despesa";
        conta_id: string;
        categoria_id: string;
        confirmado: number;
    }): Promise<void> {
        await this.db.run(
            `INSERT INTO lancamentos (
        id,
        usuario_id,
        descricao,
        valor,
        data,
        tipo,
        conta_id,
        cartao_id,
        fatura_id,
        categoria_id,
        confirmado,
        fixo,
        frequencia,
        parcela_atual,
        parcela_total,
        grupo_parcelamento_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                lancamento.id,
                USUARIO_LOCAL_ID,
                lancamento.descricao,
                lancamento.valor,
                lancamento.data,
                lancamento.tipo,
                lancamento.conta_id,
                null,
                null,
                lancamento.categoria_id,
                lancamento.confirmado,
                0,
                null,
                null,
                null,
                null,
            ],
        );
    }

    // =====================================================================
    // PARCELAMENTO
    // =====================================================================

    private async salvarParcelamento(
        descricao: string,
        valorTotal: number,
        origem: {
            conta_id: string | null;
            cartao_id: string | null;
        },
    ): Promise<void> {
        const quantidade = Number(this.form.quantidadeParcelas);

        const valorBase = Math.floor((valorTotal / quantidade) * 100) / 100;

        const sobra = Math.round((valorTotal - valorBase * quantidade) * 100) / 100;

        let dataAtual = this.form.data;

        const grupoId = this.gerarId();

        for (let i = 1; i <= quantidade; i++) {
            const valorParcela = i === 1 ? valorBase + sobra : valorBase;

            const id = this.gerarId();

            await this.inserirLancamentoComRepeticao(
                {
                    id,
                    descricao,
                    valor: valorParcela,
                    data: dataAtual,
                    tipo: this.tipoModal!,
                    conta_id: origem.conta_id,
                    cartao_id: origem.cartao_id,
                    categoria_id: this.form.categoria_id || null,
                    confirmado: this.form.confirmado && i === 1 ? 1 : 0,
                    parcela_atual: i,
                    parcela_total: quantidade,
                },
                {
                    fixo: 0,
                    frequencia: this.form.frequencia,
                    grupoParcelamentoId: grupoId,
                    primeiraOcorrencia: i === 1,
                },
            );

            dataAtual = this.adicionarIntervalo(dataAtual, this.form.frequencia);
        }
    }

    // =====================================================================
    // REPETIÇÃO FIXA
    // =====================================================================

    private async salvarLancamentoFixo(
        descricao: string,
        valor: number,
        origem: {
            conta_id: string | null;
            cartao_id: string | null;
        },
    ): Promise<void> {
        const dataInicial = this.form.data;

        const dataFinal = this.obterFimDoAno(dataInicial);

        let dataAtual = dataInicial;

        const grupoId = this.gerarId();

        if (!this.frequencias.some((item) => item.valor === this.form.frequencia)) {
            throw new Error("Frequência de repetição inválida.");
        }

        let contador = 0;

        const LIMITE_SEGURANCA = 10000;

        while (dataAtual <= dataFinal && contador < LIMITE_SEGURANCA) {
            await this.inserirLancamentoComRepeticao(
                {
                    id: this.gerarId(),
                    descricao,
                    valor,
                    data: dataAtual,
                    tipo: this.tipoModal!,
                    conta_id: origem.conta_id,
                    cartao_id: origem.cartao_id,
                    categoria_id: this.form.categoria_id || null,
                    confirmado: contador === 0 && this.form.confirmado ? 1 : 0,
                    parcela_atual: null,
                    parcela_total: null,
                },
                {
                    fixo: 1,
                    frequencia: this.form.frequencia,
                    grupoParcelamentoId: grupoId,
                    primeiraOcorrencia: contador === 0,
                },
            );

            const proximaData = this.adicionarIntervalo(
                dataAtual,
                this.form.frequencia,
            );

            if (proximaData === dataAtual) {
                break;
            }

            dataAtual = proximaData;

            contador++;
        }

        if (contador >= LIMITE_SEGURANCA) {
            throw new Error(
                "Limite de segurança atingido ao gerar lançamentos fixos.",
            );
        }
    }

    // =====================================================================
    // INSERÇÃO DE LANÇAMENTOS REPETIDOS
    // =====================================================================

    private async inserirLancamentoComRepeticao(
        lancamento: {
            id: string;
            descricao: string;
            valor: number;
            data: string;
            tipo: "receita" | "despesa";
            conta_id: string | null;
            cartao_id: string | null;
            categoria_id: string | null;
            confirmado: number;
            parcela_atual: number | null;
            parcela_total: number | null;
        },
        repeticao: {
            fixo: number;
            frequencia: string;
            grupoParcelamentoId: string;
            /**
             * Observação, tags e anexos ficam só na 1ª ocorrência da série —
             * senão um anexo (por ex.) seria duplicado em todas as parcelas
             * ou em todas as ocorrências de um fixo, inchando o banco.
             */
            primeiraOcorrencia: boolean;
        },
    ): Promise<void> {
        let faturaId: string | null = null;

        if (lancamento.cartao_id) {
            const fatura = await this.db.obterOuCriarFatura(
                lancamento.cartao_id,
                lancamento.data,
            );

            faturaId = fatura.id;
        }

        await this.db.run(
            `INSERT INTO lancamentos (
        id,
        usuario_id,
        descricao,
        valor,
        data,
        tipo,
        conta_id,
        cartao_id,
        fatura_id,
        categoria_id,
        confirmado,
        fixo,
        frequencia,
        parcela_atual,
        parcela_total,
        grupo_parcelamento_id,
        observacao
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                lancamento.id,
                USUARIO_LOCAL_ID,
                lancamento.descricao,
                lancamento.valor,
                lancamento.data,
                lancamento.tipo,
                lancamento.conta_id,
                lancamento.cartao_id,
                faturaId,
                lancamento.categoria_id,
                lancamento.confirmado,
                repeticao.fixo,
                repeticao.frequencia,
                lancamento.parcela_atual,
                lancamento.parcela_total,
                repeticao.grupoParcelamentoId,
                repeticao.primeiraOcorrencia
                    ? this.form.observacao.trim() || null
                    : null,
            ],
        );

        if (repeticao.primeiraOcorrencia) {
            if (this.form.tagIds.length) {
                await this.db.salvarTagsDoLancamento(lancamento.id, this.form.tagIds);
            }
            await this.salvarAnexosPendentes(lancamento.id);
        }
    }
}
