import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import {
    DatabaseService,
    USUARIO_LOCAL_ID,
    EscopoEdicao,
} from "../../services/database.service";

interface Conta {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
}

interface Cartao {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
}

interface Categoria {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
    categoria_pai_id?: string | null;
}

interface Lancamento {
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

interface TagRef {
    id: string;
    nome: string;
}

interface AnexoExistente {
    id: string;
    nome: string;
    tamanho: number;
}

interface GrupoLancamentos {
    data: string;
    dia: number;
    lancamentos: Lancamento[];
}

interface AnexoForm {
    nome: string;
    tamanho: number;
    arquivo: File;
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

@Component({
    selector: "app-lancamentos",
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: "./lancamentos.component.html",
    styleUrl: "./lancamentos.component.css",
})
export class LancamentosComponent implements OnInit {

    lancamentos: Lancamento[] = [];

    contas: Conta[] = [];
    cartoes: Cartao[] = [];
    categorias: Categoria[] = [];

    gruposLancamentos: GrupoLancamentos[] = [];

    mesSelecionado = "";

    menuAdicionarAberto = false;

    modalAberto = false;
    tipoModal: "receita" | "despesa" | null = null;

    /*
     * ID do lançamento que está sendo editado.
     *
     * null = criação de novo lançamento
     * string = edição
     */
    editarId: string | null = null;

    /**
     * true quando o lançamento em edição pertence a um grupo de repetição
     * (fixo ou parcelado). Nesse caso o tipo de repetição fica travado e
     * aparecem as opções de escopo (todos / atual e próximos / atual).
     */
    editandoGrupo = false;
    tipoRepeticaoOriginal: "fixa" | "parcelada" | null = null;
    escopoEdicao: EscopoEdicao = "atual";

    modalExcluirAberto = false;
    lancamentoParaExcluir: Lancamento | null = null;

    salvando = false;

    /** Tags cadastradas no CRUD de tags, usadas para popular o select. */
    tagsDisponiveis: TagRef[] = [];
    /** Tag selecionada no <select> antes de clicar em "adicionar". */
    novaTagId = "";

    /** Tags/anexos dos lançamentos carregados no mês, indexados por id do lançamento (para a listagem). */
    tagsPorLancamento: Record<string, TagRef[]> = {};
    anexosCountPorLancamento: Record<string, number> = {};

    /** Anexos já salvos no banco do lançamento em edição (distintos dos arquivos recém-selecionados em form.anexos). */
    anexosExistentes: AnexoExistente[] = [];

    opcoes = {
        repetir: false,
        observacao: false,
        anexo: false,
        tags: false,
    };

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

    constructor(
        private db: DatabaseService,
        private route: ActivatedRoute,
    ) { }

    async ngOnInit(): Promise<void> {
        this.mesSelecionado = this.obterMesAtual();

        await this.carregar();

        const novo = this.route.snapshot.queryParamMap.get("novo");
        if (novo === "despesa" || novo === "receita") {
            this.abrirModal(novo);
        }
    }

    // =====================================================================
    // FORMULÁRIO
    // =====================================================================

    private criarFormulario(): FormLancamento {
        return {
            descricao: "",
            valor: "",
            data: this.obterDataAtual(),

            origem: "",
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

    private obterMesAtual(): string {
        const hoje = new Date();

        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, "0");

        return `${ano}-${mes}`;
    }

    // =====================================================================
    // CARREGAMENTO
    // =====================================================================

    async carregar(): Promise<void> {
        this.contas = await this.db.query<Conta>(
            `
                SELECT *
                FROM contas
                WHERE usuario_id = ?
                ORDER BY nome
            `,
            [USUARIO_LOCAL_ID],
        );

        this.cartoes = await this.db.query<Cartao>(
            `
                SELECT *
                FROM cartoes_credito
                WHERE usuario_id = ?
                ORDER BY nome
            `,
            [USUARIO_LOCAL_ID],
        );

        this.categorias = await this.db.query<Categoria>(
            `
                SELECT *
                FROM categorias
                WHERE usuario_id = ?
                ORDER BY nome
            `,
            [USUARIO_LOCAL_ID],
        );

        this.tagsDisponiveis = await this.db.query<TagRef>(
            `
                SELECT id, nome
                FROM tags
                WHERE usuario_id = ?
                ORDER BY nome
            `,
            [USUARIO_LOCAL_ID],
        );

        await this.carregarLancamentos();
    }

    async carregarLancamentos(): Promise<void> {
        if (!this.mesSelecionado) {
            return;
        }

        const [ano, mes] = this.mesSelecionado.split("-");

        const primeiroDia = `${ano}-${mes}-01`;

        const proximoMes = new Date(Number(ano), Number(mes), 1);

        const proximoAno = proximoMes.getFullYear();

        const proximoMesNumero = String(proximoMes.getMonth() + 1).padStart(2, "0");

        const primeiroDiaProximoMes = `${proximoAno}-${proximoMesNumero}-01`;

        this.lancamentos = await this.db.query<Lancamento>(
            `
                SELECT *
                FROM lancamentos
                WHERE usuario_id = ?
                AND data >= ?
                AND data < ?
                ORDER BY data ASC
            `,
            [USUARIO_LOCAL_ID, primeiroDia, primeiroDiaProximoMes],
        );

        const ids = this.lancamentos.map((l) => l.id);

        if (ids.length) {
            this.tagsPorLancamento = await this.db.obterTagsPorLancamentos(ids);
            this.anexosCountPorLancamento =
                await this.db.contarAnexosPorLancamentos(ids);
        } else {
            this.tagsPorLancamento = {};
            this.anexosCountPorLancamento = {};
        }

        this.organizarPorDia();
    }

    organizarPorDia(): void {
        const grupos = new Map<string, Lancamento[]>();

        for (const lancamento of this.lancamentos) {
            if (!grupos.has(lancamento.data)) {
                grupos.set(lancamento.data, []);
            }

            grupos.get(lancamento.data)!.push(lancamento);
        }

        this.gruposLancamentos = Array.from(grupos.entries()).map(
            ([data, lancamentos]) => ({
                data,
                dia: Number(data.split("-")[2]),
                lancamentos,
            }),
        );
    }

    async alterarMes(): Promise<void> {
        await this.carregarLancamentos();
    }

    async mesAnterior(): Promise<void> {
        const [ano, mes] = this.mesSelecionado.split("-");

        const data = new Date(Number(ano), Number(mes) - 2, 1);

        this.mesSelecionado = this.formatarMes(data);

        await this.carregarLancamentos();
    }

    async proximoMes(): Promise<void> {
        const [ano, mes] = this.mesSelecionado.split("-");

        const data = new Date(Number(ano), Number(mes), 1);

        this.mesSelecionado = this.formatarMes(data);

        await this.carregarLancamentos();
    }

    private formatarMes(data: Date): string {
        const ano = data.getFullYear();

        const mes = String(data.getMonth() + 1).padStart(2, "0");

        return `${ano}-${mes}`;
    }

    nomeMes(): string {
        if (!this.mesSelecionado) {
            return "";
        }

        const [ano, mes] = this.mesSelecionado.split("-");

        const data = new Date(Number(ano), Number(mes) - 1, 1);

        return data.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric",
        });
    }

    // =====================================================================
    // MODAL
    // =====================================================================

    toggleMenuAdicionar(): void {
        this.menuAdicionarAberto = !this.menuAdicionarAberto;
    }

    abrirModal(tipo: "receita" | "despesa"): void {
        this.menuAdicionarAberto = false;

        this.tipoModal = tipo;

        this.editarId = null;
        this.editandoGrupo = false;
        this.tipoRepeticaoOriginal = null;
        this.escopoEdicao = "atual";

        this.form = this.criarFormulario();

        this.opcoes = {
            repetir: false,
            observacao: false,
            anexo: false,
            tags: false,
        };

        this.novaTagId = "";
        this.anexosExistentes = [];

        this.modalAberto = true;
    }

    /*
     * Abre o mesmo modal utilizado para criação,
     * porém preenchendo os dados do lançamento existente.
     */
    async editarLancamento(lancamento: Lancamento): Promise<void> {
        this.menuAdicionarAberto = false;

        this.editarId = lancamento.id;

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
            };
        } else {
            this.tipoRepeticaoOriginal = null;

            this.opcoes = {
                repetir: false,
                observacao: false,
                anexo: false,
                tags: false,
            };
        }

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
        this.editandoGrupo = false;
        this.tipoRepeticaoOriginal = null;
        this.escopoEdicao = "atual";

        this.salvando = false;
    }

    alternarOpcao(opcao: "repetir" | "observacao" | "anexo" | "tags"): void {
        /*
         * Durante edição, a opção "repetir" nunca é alternável por clique:
         * lançamento único não vira repetição, e lançamento de grupo já
         * fica sempre com o painel de repetição aberto (travado).
         */
        if (this.editarId && opcao === "repetir") {
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
    }

    // =====================================================================
    // CATEGORIAS
    // =====================================================================

    get categoriasPrincipais(): Categoria[] {
        return this.categorias.filter((categoria) => !categoria.categoria_pai_id);
    }

    subcategoriasDa(categoriaId: string): Categoria[] {
        return this.categorias.filter(
            (categoria) => categoria.categoria_pai_id === categoriaId,
        );
    }

    categoria(lancamento: Lancamento): Categoria | null {
        if (!lancamento.categoria_id) {
            return null;
        }

        return (
            this.categorias.find(
                (categoria) => categoria.id === lancamento.categoria_id,
            ) ?? null
        );
    }

    nomeCategoria(lancamento: Lancamento): string {
        return this.categoria(lancamento)?.nome ?? "Sem categoria";
    }

    iconeCategoria(lancamento: Lancamento): string {
        return this.categoria(lancamento)?.icone || "category";
    }

    corCategoria(lancamento: Lancamento): string {
        return this.categoria(lancamento)?.cor || "#4285f4";
    }

    // =====================================================================
    // ORIGEM
    // =====================================================================

    nomeOrigem(lancamento: Lancamento): string {
        if (lancamento.conta_id) {
            return (
                this.contas.find((conta) => conta.id === lancamento.conta_id)?.nome ??
                "-"
            );
        }

        if (lancamento.cartao_id) {
            return (
                this.cartoes.find((cartao) => cartao.id === lancamento.cartao_id)
                    ?.nome ?? "-"
            );
        }

        return "-";
    }

    iconeOrigem(lancamento: Lancamento): string {
        if (lancamento.conta_id) {
            const conta = this.contas.find((item) => item.id === lancamento.conta_id);

            return conta?.icone || "account_balance_wallet";
        }

        if (lancamento.cartao_id) {
            const cartao = this.cartoes.find(
                (item) => item.id === lancamento.cartao_id,
            );

            return cartao?.icone || "credit_card";
        }

        return "account_balance_wallet";
    }

    corOrigem(lancamento: Lancamento): string {
        if (lancamento.conta_id) {
            return (
                this.contas.find((conta) => conta.id === lancamento.conta_id)?.cor ||
                "#4285f4"
            );
        }

        if (lancamento.cartao_id) {
            return (
                this.cartoes.find((cartao) => cartao.id === lancamento.cartao_id)
                    ?.cor || "#4285f4"
            );
        }

        return "#4285f4";
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
    // PARCELAS
    // =====================================================================

    ehParcelado(lancamento: Lancamento): boolean {
        return !!lancamento.parcela_total && lancamento.parcela_total > 1;
    }

    textoParcela(lancamento: Lancamento): string {
        if (!this.ehParcelado(lancamento)) {
            return "";
        }

        return `${lancamento.parcela_atual}/${lancamento.parcela_total}`;
    }

    /** true quando o lançamento é uma recorrência fixa (não parcelada). */
    ehFixo(lancamento: Lancamento): boolean {
        return Number(lancamento.fixo) === 1;
    }

    /** Tags do lançamento, pro indicador da listagem (já vem do mapa carregado em bloco). */
    tagsDoLancamento(lancamento: Lancamento): TagRef[] {
        return this.tagsPorLancamento[lancamento.id] ?? [];
    }

    /** Texto "tag1, tag2, tag3" pra usar como tooltip do indicador de tags. */
    tituloTags(lancamento: Lancamento): string {
        return this.tagsDoLancamento(lancamento)
            .map((t) => t.nome)
            .join(", ");
    }

    /** Quantidade de anexos do lançamento, pro indicador da listagem. */
    quantidadeAnexos(lancamento: Lancamento): number {
        return this.anexosCountPorLancamento[lancamento.id] ?? 0;
    }

    valorFormatado(valor: number): string {
        return valor.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    valorNumerico(): number {
        const valor = String(this.form.valor || "")
            .replace(/\s/g, "")
            .replace(/\./g, "")
            .replace(",", ".");

        const numero = Number(valor);

        return Number.isFinite(numero) ? numero : 0;
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
        return this.tagsDisponiveis.filter((t) => !this.form.tagIds.includes(t.id));
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

        // Atualiza o contador da listagem, já que pode estar editando
        // um lançamento que está sendo exibido no mês atual.
        if (this.editarId) {
            const total = this.anexosCountPorLancamento[this.editarId] ?? 0;
            if (total > 0) {
                this.anexosCountPorLancamento[this.editarId] = total - 1;
            }
        }
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

        if (!descricao) {
            alert("Informe a descrição do lançamento.");
            return;
        }

        if (valor <= 0) {
            alert("Informe um valor válido.");
            return;
        }

        if (!this.form.data) {
            alert("Informe a data do lançamento.");
            return;
        }

        this.salvando = true;

        try {
            const origem = this.processarOrigem();

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

                await this.carregarLancamentos();

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

            await this.carregarLancamentos();

            this.fecharModal();
        } catch (erro) {
            console.error("Erro ao salvar lançamento:", erro);

            alert("Não foi possível salvar o lançamento.");
        } finally {
            this.salvando = false;
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

    // =====================================================================
    // CONFIRMAÇÃO
    // =====================================================================

    async alternarConfirmado(lancamento: Lancamento): Promise<void> {
        // Number(...) por segurança: alguns drivers podem devolver o valor
        // do SQLite como string/bigint em vez de number.
        const novoEstado = Number(lancamento.confirmado) === 1 ? 0 : 1;

        try {
            await this.db.run(
                `UPDATE lancamentos
         SET confirmado = ?
         WHERE id = ?
         AND usuario_id = ?`,
                [novoEstado, lancamento.id, USUARIO_LOCAL_ID],
            );

            lancamento.confirmado = novoEstado;
        } catch (erro) {
            console.error("Erro ao alterar confirmação:", erro);

            alert("Não foi possível alterar o status do lançamento.");
        }
    }

    // =====================================================================
    // REMOÇÃO
    // =====================================================================

    /*
     * Lançamento único: exclui direto.
     * Lançamento de grupo (fixo ou parcelado): abre o modal perguntando
     * o escopo (todos / atual e próximos / apenas atual).
     */
    remover(lancamento: Lancamento): void {
        if (!lancamento.grupo_parcelamento_id) {
            this.excluirComEscopo(lancamento.id, "atual");
            return;
        }

        this.lancamentoParaExcluir = lancamento;
        this.modalExcluirAberto = true;
    }

    fecharModalExcluir(): void {
        this.modalExcluirAberto = false;
        this.lancamentoParaExcluir = null;
    }

    async confirmarExclusao(escopo: EscopoEdicao): Promise<void> {
        if (!this.lancamentoParaExcluir) return;

        await this.excluirComEscopo(this.lancamentoParaExcluir.id, escopo);
        this.fecharModalExcluir();
    }

    private async excluirComEscopo(
        id: string,
        escopo: EscopoEdicao,
    ): Promise<void> {
        try {
            await this.db.excluirLancamentoComEscopo(id, escopo);
            await this.carregarLancamentos();
        } catch (erro) {
            console.error("Erro ao excluir lançamento:", erro);
            alert("Não foi possível excluir o lançamento.");
        }
    }
}
