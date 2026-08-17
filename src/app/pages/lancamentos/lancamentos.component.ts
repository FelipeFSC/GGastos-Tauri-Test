import { Component, HostListener, OnInit, ViewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink, ActivatedRoute } from "@angular/router";
import {
    DatabaseService,
    USUARIO_LOCAL_ID,
    FaturaResumoPeriodo,
} from "../../services/database.service";
import {
    LancamentoModalComponent,
    Lancamento,
    TagRef,
} from "../../shared/lancamento-modal/lancamento-modal.component";

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

const NOMES_MES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Um item do dia: ou um lançamento normal, ou a linha-resumo de uma fatura. */
interface ItemDia {
    ehFatura: boolean;
    lancamento?: Lancamento;
    fatura?: FaturaResumoPeriodo;
}

interface GrupoLancamentos {
    data: string;
    dia: number;
    itens: ItemDia[];
}

@Component({
    selector: "app-lancamentos",
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, LancamentoModalComponent],
    templateUrl: "./lancamentos.component.html",
    styleUrl: "./lancamentos.component.css",
})
export class LancamentosComponent implements OnInit {
    @ViewChild("modal") modal!: LancamentoModalComponent;

    lancamentos: Lancamento[] = [];
    faturasDoMes: FaturaResumoPeriodo[] = [];

    contas: Conta[] = [];
    cartoes: Cartao[] = [];
    categorias: Categoria[] = [];

    gruposLancamentos: GrupoLancamentos[] = [];

    mesSelecionado = "";

    menuAdicionarAberto = false;
    menuMaisAberto = false;

    /** Qual dropdown de filtro está aberto no momento (só um por vez). */
    filtroAberto: "tipo" | "origem" | "categoria" | null = null;

    /** Conjuntos vazios = sem restrição (mostra tudo) nesse filtro. */
    filtroTipos = new Set<string>();
    filtroOrigens = new Set<string>();
    filtroCategorias = new Set<string>();

    /** Tags/anexos dos lançamentos carregados no mês, indexados por id do lançamento (para a listagem). */
    tagsPorLancamento: Record<string, TagRef[]> = {};
    anexosCountPorLancamento: Record<string, number> = {};

    constructor(
        private db: DatabaseService,
        private route: ActivatedRoute,
    ) { }

    /*
     * Fecha qualquer dropdown de filtro aberto ao clicar fora dele.
     * Os cliques dentro do próprio dropdown chamam stopPropagation()
     * no template, então nunca chegam até aqui.
     */
    @HostListener("document:click")
    fecharFiltros(): void {
        this.filtroAberto = null;
    }

    async ngOnInit(): Promise<void> {
        this.mesSelecionado = this.obterMesAtual();

        await this.carregar();

        const novo = this.route.snapshot.queryParamMap.get("novo");
        if (novo === "despesa" || novo === "receita") {
            this.modal.abrirNovo(novo);
        }
    }

    // =====================================================================
    // DATAS
    // =====================================================================

    nomeMesFatura(mesReferencia: number): string {
        return NOMES_MES[mesReferencia - 1];
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
                AND cartao_id IS NULL
                ORDER BY data ASC
            `,
            [USUARIO_LOCAL_ID, primeiroDia, primeiroDiaProximoMes],
        );

        this.faturasDoMes = await this.db.listarFaturasPorVencimento(
            primeiroDia,
            primeiroDiaProximoMes,
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
        const grupos = new Map<string, ItemDia[]>();

        const garantirGrupo = (data: string): ItemDia[] => {
            if (!grupos.has(data)) {
                grupos.set(data, []);
            }

            return grupos.get(data)!;
        };

        for (const lancamento of this.aplicarFiltros(this.lancamentos)) {
            garantirGrupo(lancamento.data).push({ ehFatura: false, lancamento });
        }

        for (const fatura of this.faturasDoMes) {
            if (this.filtroOrigens.size && !this.filtroOrigens.has(`cartao:${fatura.cartao_id}`)) {
                continue;
            }

            garantirGrupo(fatura.data_vencimento).push({ ehFatura: true, fatura });
        }

        this.gruposLancamentos = Array.from(grupos.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([data, itens]) => ({
                data,
                dia: Number(data.split("-")[2]),
                itens,
            }));
    }

    // =====================================================================
    // FILTROS
    // =====================================================================

    private aplicarFiltros(lista: Lancamento[]): Lancamento[] {
        return lista.filter((lancamento) => {
            if (this.filtroTipos.size && !this.filtroTipos.has(lancamento.tipo)) {
                return false;
            }

            if (this.filtroOrigens.size) {
                const chave = lancamento.conta_id
                    ? `conta:${lancamento.conta_id}`
                    : lancamento.cartao_id
                        ? `cartao:${lancamento.cartao_id}`
                        : null;

                if (!chave || !this.filtroOrigens.has(chave)) {
                    return false;
                }
            }

            if (
                this.filtroCategorias.size &&
                (!lancamento.categoria_id || !this.filtroCategorias.has(lancamento.categoria_id))
            ) {
                return false;
            }

            return true;
        });
    }

    alternarFiltro(filtro: "tipo" | "origem" | "categoria"): void {
        this.filtroAberto = this.filtroAberto === filtro ? null : filtro;
    }

    private alternarNoConjunto(conjunto: Set<string>, valor: string): void {
        if (conjunto.has(valor)) {
            conjunto.delete(valor);
        } else {
            conjunto.add(valor);
        }

        this.organizarPorDia();
    }

    alternarFiltroTipo(tipo: string): void {
        this.alternarNoConjunto(this.filtroTipos, tipo);
    }

    alternarFiltroOrigem(chave: string): void {
        this.alternarNoConjunto(this.filtroOrigens, chave);
    }

    alternarFiltroCategoria(categoriaId: string): void {
        this.alternarNoConjunto(this.filtroCategorias, categoriaId);
    }

    temFiltrosAtivos(): boolean {
        return (
            this.filtroTipos.size > 0 ||
            this.filtroOrigens.size > 0 ||
            this.filtroCategorias.size > 0
        );
    }

    limparFiltros(): void {
        this.filtroTipos.clear();
        this.filtroOrigens.clear();
        this.filtroCategorias.clear();

        this.organizarPorDia();
    }

    // =====================================================================
    // SALDO / PREVISTO DO MÊS
    // =====================================================================

    /** Soma só do que já foi confirmado (pago/recebido) no mês. */
    saldoMes(): number {
        return this.lancamentos
            .filter((lancamento) => Number(lancamento.confirmado) === 1)
            .reduce(
                (soma, lancamento) =>
                    soma + (lancamento.tipo === "receita" ? lancamento.valor : -lancamento.valor),
                0,
            );
    }

    /** Soma de tudo (confirmado ou não) — resultado projetado do mês. */
    previstoMes(): number {
        return this.lancamentos.reduce(
            (soma, lancamento) =>
                soma + (lancamento.tipo === "receita" ? lancamento.valor : -lancamento.valor),
            0,
        );
    }

    valorComSinal(valor: number): string {
        return `${valor < 0 ? "-" : ""}R$ ${this.valorFormatado(Math.abs(valor))}`;
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
    // ADICIONAR / EDITAR (o pop-up em si é o app-lancamento-modal)
    // =====================================================================

    toggleMenuAdicionar(): void {
        this.menuAdicionarAberto = !this.menuAdicionarAberto;
    }

    toggleMenuMais(): void {
        this.menuMaisAberto = !this.menuMaisAberto;
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

}
