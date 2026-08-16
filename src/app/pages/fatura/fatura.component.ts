import { Component, OnInit, ViewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import {
    DatabaseService,
    FaturaDetalhada,
    PagamentoFatura,
} from "../../services/database.service";
import {
    LancamentoModalComponent,
    Lancamento,
    TagRef,
} from "../../shared/lancamento-modal/lancamento-modal.component";

interface Categoria {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
    categoria_pai_id?: string | null;
}

interface ContaOpcao {
    id: string;
    nome: string;
}

interface FormPagamento {
    valor: string;
    data: string;
    contaId: string;
}

interface GrupoLancamentos {
    data: string;
    dia: number;
    itens: Lancamento[];
}

const NOMES_MES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

@Component({
    selector: "app-fatura",
    standalone: true,
    imports: [CommonModule, FormsModule, LancamentoModalComponent],
    templateUrl: "./fatura.component.html",
    styleUrl: "./fatura.component.css",
})
export class FaturaComponent implements OnInit {
    @ViewChild("modal") modal!: LancamentoModalComponent;

    faturaId = "";
    fatura: FaturaDetalhada | null = null;

    anteriorId: string | null = null;
    proximaId: string | null = null;

    categorias: Categoria[] = [];
    contas: ContaOpcao[] = [];

    lancamentos: Lancamento[] = [];
    lancamentosFiltrados: Lancamento[] = [];
    gruposLancamentos: GrupoLancamentos[] = [];
    filtro = "";

    tagsPorLancamento: Record<string, TagRef[]> = {};
    anexosCountPorLancamento: Record<string, number> = {};

    menuAdicionarAberto = false;

    modalPagamentoAberto = false;
    pagamentoEmEdicaoId: string | null = null;
    formPagamento: FormPagamento = { valor: "", data: "", contaId: "" };
    salvandoPagamento = false;

    constructor(
        private db: DatabaseService,
        private route: ActivatedRoute,
        private router: Router,
    ) { }

    ngOnInit(): void {
        this.route.paramMap.subscribe(async (params) => {
            const id = params.get("id");

            if (!id) {
                return;
            }

            this.faturaId = id;

            await this.carregar();
        });
    }

    get nomeMes(): string {
        return this.fatura ? NOMES_MES[this.fatura.mes_referencia - 1] : "";
    }

    // =====================================================================
    // CARREGAMENTO
    // =====================================================================

    async carregar(): Promise<void> {
        this.fatura = await this.db.obterFaturaDetalhada(this.faturaId);

        if (!this.fatura) {
            return;
        }

        this.categorias = await this.db.query<Categoria>(
            `SELECT * FROM categorias WHERE usuario_id = (SELECT usuario_id FROM cartoes_credito WHERE id = ?) ORDER BY nome`,
            [this.fatura.cartao_id],
        );

        this.contas = await this.db.query<ContaOpcao>(
            `SELECT id, nome FROM contas WHERE usuario_id = (SELECT usuario_id FROM cartoes_credito WHERE id = ?) ORDER BY nome`,
            [this.fatura.cartao_id],
        );

        const [anterior, proxima] = await Promise.all([
            this.db.obterFaturaAdjacente(
                this.fatura.cartao_id,
                this.fatura.mes_referencia,
                this.fatura.ano_referencia,
                "anterior",
            ),
            this.db.obterFaturaAdjacente(
                this.fatura.cartao_id,
                this.fatura.mes_referencia,
                this.fatura.ano_referencia,
                "proxima",
            ),
        ]);

        this.anteriorId = anterior?.id ?? null;
        this.proximaId = proxima?.id ?? null;

        await this.carregarLancamentos();
    }

    async carregarLancamentos(): Promise<void> {
        this.lancamentos = await this.db.listarLancamentosDaFatura(this.faturaId);

        const ids = this.lancamentos.map((l) => l.id);

        if (ids.length) {
            this.tagsPorLancamento = await this.db.obterTagsPorLancamentos(ids);
            this.anexosCountPorLancamento = await this.db.contarAnexosPorLancamentos(ids);
        } else {
            this.tagsPorLancamento = {};
            this.anexosCountPorLancamento = {};
        }

        this.aplicarFiltro();
    }

    aplicarFiltro(): void {
        const termo = this.filtro.trim().toLowerCase();

        this.lancamentosFiltrados = termo
            ? this.lancamentos.filter((l) => (l.descricao || "").toLowerCase().includes(termo))
            : this.lancamentos;

        this.organizarPorDia();
    }

    private organizarPorDia(): void {
        const grupos = new Map<string, Lancamento[]>();

        for (const lancamento of this.lancamentosFiltrados) {
            if (!grupos.has(lancamento.data)) {
                grupos.set(lancamento.data, []);
            }

            grupos.get(lancamento.data)!.push(lancamento);
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
    // NAVEGAÇÃO ENTRE FATURAS
    // =====================================================================

    async irParaAnterior(): Promise<void> {
        if (this.anteriorId) {
            await this.router.navigate(["/fatura", this.anteriorId]);
        }
    }

    async irParaProxima(): Promise<void> {
        if (this.proximaId) {
            await this.router.navigate(["/fatura", this.proximaId]);
        }
    }

    // =====================================================================
    // LANÇAMENTOS
    // =====================================================================

    toggleMenuAdicionar(): void {
        this.menuAdicionarAberto = !this.menuAdicionarAberto;
    }

    categoria(lancamento: Lancamento): Categoria | null {
        if (!lancamento.categoria_id) {
            return null;
        }

        return this.categorias.find((c) => c.id === lancamento.categoria_id) ?? null;
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

    ehParcelado(lancamento: Lancamento): boolean {
        return !!lancamento.parcela_total && lancamento.parcela_total > 1;
    }

    textoParcela(lancamento: Lancamento): string {
        if (!this.ehParcelado(lancamento)) {
            return "";
        }

        return `${lancamento.parcela_atual}/${lancamento.parcela_total}`;
    }

    ehFixo(lancamento: Lancamento): boolean {
        return Number(lancamento.fixo) === 1;
    }

    tagsDoLancamento(lancamento: Lancamento): TagRef[] {
        return this.tagsPorLancamento[lancamento.id] ?? [];
    }

    tituloTags(lancamento: Lancamento): string {
        return this.tagsDoLancamento(lancamento).map((t) => t.nome).join(", ");
    }

    quantidadeAnexos(lancamento: Lancamento): number {
        return this.anexosCountPorLancamento[lancamento.id] ?? 0;
    }

    valorFormatado(valor: number): string {
        return valor.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /**
     * Saldo mês anterior, valor da fatura e valor restante podem ficar
     * negativos quando o usuário paga mais do que devia — nesse caso o
     * valor é um crédito a favor dele (reduz a próxima fatura), não uma
     * dívida. Exibimos o valor absoluto com a marcação "crédito" em vez
     * de um número negativo, que lido sozinho passa a ideia errada de
     * que ele ficou devendo.
     */
    ehCredito(valor: number): boolean {
        return valor < -0.004;
    }

    valorAbsFormatado(valor: number): string {
        return this.valorFormatado(Math.abs(valor));
    }

    async alternarConfirmado(lancamento: Lancamento): Promise<void> {
        const novoEstado = Number(lancamento.confirmado) === 1 ? 0 : 1;

        try {
            await this.db.run(
                `UPDATE lancamentos SET confirmado = ? WHERE id = ?`,
                [novoEstado, lancamento.id],
            );

            lancamento.confirmado = novoEstado;
        } catch (erro) {
            console.error("Erro ao alterar confirmação:", erro);

            alert("Não foi possível alterar o status do lançamento.");
        }
    }

    // =====================================================================
    // PAGAMENTO
    // =====================================================================

    private obterDataAtual(): string {
        const hoje = new Date();

        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, "0");
        const dia = String(hoje.getDate()).padStart(2, "0");

        return `${ano}-${mes}-${dia}`;
    }

    abrirModalPagamento(): void {
        if (!this.fatura) return;

        this.pagamentoEmEdicaoId = null;

        this.formPagamento = {
            valor: this.valorFormatado(this.fatura.valorRestante),
            data: this.obterDataAtual(),
            contaId: this.fatura.conta_pagamento_id || "",
        };

        this.modalPagamentoAberto = true;
    }

    abrirModalEdicaoPagamento(pagamento: PagamentoFatura): void {
        this.pagamentoEmEdicaoId = pagamento.id;

        this.formPagamento = {
            valor: this.valorFormatado(pagamento.valor),
            data: pagamento.data,
            contaId: pagamento.conta_id || "",
        };

        this.modalPagamentoAberto = true;
    }

    fecharModalPagamento(): void {
        this.modalPagamentoAberto = false;
        this.pagamentoEmEdicaoId = null;
        this.salvandoPagamento = false;
    }

    private valorNumericoPagamento(): number {
        const valor = String(this.formPagamento.valor || "")
            .replace(/\s/g, "")
            .replace(/\./g, "")
            .replace(",", ".");

        const numero = Number(valor);

        return Number.isFinite(numero) ? numero : 0;
    }

    async salvarPagamento(): Promise<void> {
        if (this.salvandoPagamento || !this.fatura) {
            return;
        }

        const valor = this.valorNumericoPagamento();

        if (valor <= 0) {
            alert("Informe um valor válido.");
            return;
        }

        if (!this.formPagamento.data) {
            alert("Informe a data do pagamento.");
            return;
        }

        this.salvandoPagamento = true;

        try {
            const contaId = this.formPagamento.contaId || null;

            if (this.pagamentoEmEdicaoId) {
                await this.db.atualizarPagamentoFatura(this.pagamentoEmEdicaoId, {
                    contaId,
                    valor,
                    data: this.formPagamento.data,
                });
            } else {
                await this.db.registrarPagamentoFatura(
                    this.faturaId,
                    contaId,
                    valor,
                    this.formPagamento.data,
                );
            }

            this.fecharModalPagamento();

            await this.carregar();
        } catch (erro) {
            console.error("Erro ao salvar pagamento:", erro);

            alert("Não foi possível salvar o pagamento.");
        } finally {
            this.salvandoPagamento = false;
        }
    }

    async excluirPagamento(pagamentoId: string): Promise<void> {
        try {
            await this.db.excluirPagamentoFatura(pagamentoId);
            await this.carregar();
        } catch (erro) {
            console.error("Erro ao excluir pagamento:", erro);

            alert("Não foi possível excluir o pagamento.");
        }
    }
}
