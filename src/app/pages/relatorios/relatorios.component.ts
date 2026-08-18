import {
	AfterViewInit,
	Component,
	ElementRef,
	HostListener,
	OnDestroy,
	OnInit,
	ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import * as echarts from "echarts";
import {
	DatabaseService,
	USUARIO_LOCAL_ID,
} from "../../services/database.service";

type TipoPeriodo =
	| "hoje"
	| "semana"
	| "mes"
	| "3meses"
	| "6meses"
	| "12meses"
	| "ano"
	| "personalizado";

type Aba = "categorias" | "entradas-saidas" | "contas" | "tags";

interface CategoriaRow {
	id: string;
	nome: string;
	tipo: string;
	icone: string | null;
	cor: string | null;
	categoria_pai_id: string | null;
}

interface LancamentoRow {
	id: string;
	categoria_id: string | null;
	descricao: string | null;
	valor: number;
	tipo: string;
	data: string;
}

interface Transacao {
	id: string;
	descricao: string;
	valor: number;
}

interface Agrupamento {
	chave: string;
	rotulo: string;
	valor: number;
	transacoes: Transacao[];
}

interface MesResumo {
	mes: number;
	receitas: number;
	despesas: number;
	saldo: number;
}

interface ContaRow {
	id: string;
	nome: string;
	saldo_inicial: number;
}

interface LancamentoContaRow {
	id: string;
	data: string;
	descricao: string | null;
	valor: number;
	tipo: string;
	categoria_id: string | null;
}

interface LancamentoConta {
	id: string;
	data: string;
	descricao: string;
	valor: number;
	tipo: "receita" | "despesa";
	categoriaNome: string;
	tagsNomes: string[];
	saldoAcumulado: number;
}

interface TransacaoTag {
	id: string;
	data: string;
	descricao: string;
	origemNome: string;
	valor: number;
	percentualDaTag: number;
}

interface LinhaTag {
	tagId: string;
	nome: string;
	cor: string;
	valor: number;
	percentual: number;
	transacoes: TransacaoTag[];
	expandida: boolean;
}

interface LinhaCategoria {
	categoriaId: string;
	nome: string;
	icone: string | null;
	cor: string;
	valor: number;
	percentual: number;
	/** true quando existem lançamentos direto na categoria pai E em pelo menos uma sub-categoria. */
	misturado: boolean;
	agrupamentos: Agrupamento[];
	transacoesDiretas: Transacao[];
	expandida: boolean;
}

/** Usada quando a categoria não tem cor definida (ou é o grupo "Sem categoria"). */
const PALETA_PADRAO = [
	"#94a3b8",
	"#a78bfa",
	"#f472b6",
	"#60a5fa",
	"#34d399",
	"#fbbf24",
	"#f87171",
	"#2dd4bf",
];

const NOMES_MES_ABREV = [
	"Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
	"Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

const NOMES_MES_COMPLETO = [
	"Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
	"Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Verde/vermelho já usados em todo o app pra receita/despesa (ex.: lancamentos.component.css). */
const COR_RECEITA = "#3c7a3c";
const COR_DESPESA = "#d93025";

const OPCOES_PERIODO: { tipo: TipoPeriodo; rotulo: string }[] = [
	{ tipo: "hoje", rotulo: "Hoje" },
	{ tipo: "semana", rotulo: "Esta semana" },
	{ tipo: "mes", rotulo: "Este mês" },
	{ tipo: "3meses", rotulo: "Últimos 3 meses" },
	{ tipo: "6meses", rotulo: "Últimos 6 meses" },
	{ tipo: "12meses", rotulo: "Últimos 12 meses" },
	{ tipo: "ano", rotulo: "Este ano" },
	{ tipo: "personalizado", rotulo: "Escolher período" },
];

@Component({
	selector: "app-relatorios",
	standalone: true,
	imports: [CommonModule, FormsModule],
	templateUrl: "./relatorios.component.html",
	styleUrl: "./relatorios.component.css",
})
export class RelatoriosComponent implements OnInit, AfterViewInit, OnDestroy {

	@ViewChild("graficoDespesas")
	graficoDespesasRef?: ElementRef<HTMLDivElement>;

	@ViewChild("graficoReceitas")
	graficoReceitasRef?: ElementRef<HTMLDivElement>;

	@ViewChild("graficoComparativo")
	graficoComparativoRef?: ElementRef<HTMLDivElement>;

	@ViewChild("graficoAcumulado")
	graficoAcumuladoRef?: ElementRef<HTMLDivElement>;

	@ViewChild("graficoConta")
	graficoContaRef?: ElementRef<HTMLDivElement>;

	opcoesPeriodo = OPCOES_PERIODO;

	abaAtiva: Aba = "categorias";

	periodoTipo: TipoPeriodo = "mes";
	periodoAncora = new Date();
	seletorPeriodoAberto = false;
	personalizadoInicio = "";
	personalizadoFim = "";

	carregando = false;

	despesas: LinhaCategoria[] = [];
	receitas: LinhaCategoria[] = [];
	totalDespesas = 0;
	totalReceitas = 0;

	// =========================================================
	// EVOLUÇÃO ANUAL (aba "Entradas x Saídas")
	// =========================================================

	anoEvolucao = new Date().getFullYear();
	carregandoEvolucao = false;

	/** Os 12 meses do ano, sempre — meses sem lançamento entram com 0. */
	resumoMensal: MesResumo[] = [];
	/** Só os meses com alguma movimentação — é o que vira linha da tabela. */
	mesesComDados: MesResumo[] = [];
	saldoAcumuladoSerie: number[] = [];

	totalReceitasAno = 0;
	totalDespesasAno = 0;
	saldoAno = 0;
	melhorMes: MesResumo | null = null;

	mediaReceitas = 0;
	mediaDespesas = 0;
	mediaSaldo = 0;

	// =========================================================
	// RELATÓRIO DE CONTA (aba "Contas")
	// =========================================================

	contas: ContaRow[] = [];
	contaSelecionadaId = "";
	anoConta = new Date().getFullYear();
	carregandoConta = false;

	resumoMensalConta: MesResumo[] = [];
	mesesComDadosContaCount = 0;
	totalEntradasConta = 0;
	totalSaidasConta = 0;
	saldoAtualConta = 0;
	lancamentosConta: LancamentoConta[] = [];

	// =========================================================
	// RELATÓRIO DE TAGS (aba "Tags")
	// =========================================================

	carregandoTags = false;
	linhasTag: LinhaTag[] = [];
	totalComTags = 0;

	private categoriasPorId = new Map<string, CategoriaRow>();
	private charts: {
		despesas: echarts.ECharts | null;
		receitas: echarts.ECharts | null;
		comparativo: echarts.ECharts | null;
		acumulado: echarts.ECharts | null;
		conta: echarts.ECharts | null;
	} = {
			despesas: null,
			receitas: null,
			comparativo: null,
			acumulado: null,
			conta: null,
		};

	constructor(private db: DatabaseService) { }

	async ngOnInit(): Promise<void> {
		await this.carregarContasDisponiveis();

		await Promise.all([
			this.carregarRelatorio(),
			this.carregarEvolucaoAnual(),
			this.carregarRelatorioConta(),
			this.carregarRelatorioTags(),
		]);
	}

	ngAfterViewInit(): void {
		// Os gráficos são criados/atualizados em carregarRelatorio()/
		// carregarEvolucaoAnual(), depois que os dados chegam — aqui não tem
		// nada pra fazer ainda.
	}

	ngOnDestroy(): void {
		for (const chart of Object.values(this.charts)) {
			chart?.dispose();
		}
	}

	@HostListener("window:resize")
	onResize(): void {
		for (const chart of Object.values(this.charts)) {
			if (chart && !chart.isDisposed()) {
				chart.resize();
			}
		}
	}

	// =====================================================================
	// ABAS
	// =====================================================================

	selecionarAba(aba: Aba): void {
		this.abaAtiva = aba;

		// As abas ficam com display:none quando não estão ativas (pra não
		// destruir os gráficos) — o ECharts não recalcula o próprio tamanho
		// sozinho quando o container volta a ficar visível, então força um
		// resize depois que o Angular aplicar a mudança de [hidden].
		setTimeout(() => this.onResize(), 0);
	}

	// =====================================================================
	// PERÍODO
	// =====================================================================

	get intervalo(): { inicio: Date; fim: Date } {
		return this.calcularIntervalo(
			this.periodoTipo,
			this.periodoAncora,
			this.personalizadoInicio,
			this.personalizadoFim,
		);
	}

	private calcularIntervalo(
		tipo: TipoPeriodo,
		ancora: Date,
		inicioPersonalizado: string,
		fimPersonalizado: string,
	): { inicio: Date; fim: Date } {
		const d = new Date(ancora);

		switch (tipo) {
			case "hoje": {
				const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate());
				const fim = new Date(
					d.getFullYear(),
					d.getMonth(),
					d.getDate(),
					23,
					59,
					59,
					999,
				);
				return { inicio, fim };
			}

			case "semana": {
				// Semana de domingo a sábado.
				const diaSemana = d.getDay();
				const inicio = new Date(
					d.getFullYear(),
					d.getMonth(),
					d.getDate() - diaSemana,
				);
				const fim = new Date(
					inicio.getFullYear(),
					inicio.getMonth(),
					inicio.getDate() + 6,
					23,
					59,
					59,
					999,
				);
				return { inicio, fim };
			}

			case "mes": {
				const inicio = new Date(d.getFullYear(), d.getMonth(), 1);
				const fim = new Date(
					d.getFullYear(),
					d.getMonth() + 1,
					0,
					23,
					59,
					59,
					999,
				);
				return { inicio, fim };
			}

			case "3meses":
			case "6meses":
			case "12meses": {
				const meses = tipo === "3meses" ? 3 : tipo === "6meses" ? 6 : 12;
				const fim = new Date(
					d.getFullYear(),
					d.getMonth() + 1,
					0,
					23,
					59,
					59,
					999,
				);
				const inicio = new Date(d.getFullYear(), d.getMonth() - (meses - 1), 1);
				return { inicio, fim };
			}

			case "ano": {
				const inicio = new Date(d.getFullYear(), 0, 1);
				const fim = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
				return { inicio, fim };
			}

			case "personalizado": {
				const inicio = inicioPersonalizado
					? new Date(inicioPersonalizado + "T00:00:00")
					: new Date(d.getFullYear(), d.getMonth(), 1);
				const fim = fimPersonalizado
					? new Date(fimPersonalizado + "T23:59:59")
					: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
				return { inicio, fim };
			}
		}
	}

	rotuloPeriodo(): string {
		const { inicio, fim } = this.intervalo;

		switch (this.periodoTipo) {
			case "mes":
				return (
					this.capitalizar(
						inicio.toLocaleDateString("pt-BR", { month: "long" }),
					) +
					" " +
					inicio.getFullYear()
				);

			case "ano":
				return String(inicio.getFullYear());

			case "semana":
				return this.formatarDiaMes(inicio) + " a " + this.formatarDiaMes(fim);

			case "hoje":
				return this.formatarDiaMes(inicio) + " " + inicio.getFullYear();

			default:
				return (
					this.formatarDiaMes(inicio) +
					" " +
					inicio.getFullYear() +
					" a " +
					this.formatarDiaMes(fim) +
					" " +
					fim.getFullYear()
				);
		}
	}

	private formatarDiaMes(d: Date): string {
		const dia = String(d.getDate()).padStart(2, "0");
		const mes = this.capitalizar(
			d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
		);
		return `${dia} ${mes}`;
	}

	private capitalizar(texto: string): string {
		return texto.charAt(0).toUpperCase() + texto.slice(1);
	}

	podeNavegar(): boolean {
		return this.periodoTipo !== "personalizado";
	}

	navegarPeriodo(direcao: 1 | -1): void {
		if (!this.podeNavegar()) {
			return;
		}

		const d = new Date(this.periodoAncora);

		switch (this.periodoTipo) {
			case "hoje":
				d.setDate(d.getDate() + direcao);
				break;
			case "semana":
				d.setDate(d.getDate() + direcao * 7);
				break;
			case "mes":
				d.setMonth(d.getMonth() + direcao);
				break;
			case "3meses":
				d.setMonth(d.getMonth() + direcao * 3);
				break;
			case "6meses":
				d.setMonth(d.getMonth() + direcao * 6);
				break;
			case "12meses":
				d.setMonth(d.getMonth() + direcao * 12);
				break;
			case "ano":
				d.setFullYear(d.getFullYear() + direcao);
				break;
		}

		this.periodoAncora = d;
		this.atualizarPeriodo();
	}

	alternarSeletorPeriodo(): void {
		this.seletorPeriodoAberto = !this.seletorPeriodoAberto;
	}

	selecionarPeriodo(tipo: TipoPeriodo): void {
		this.periodoTipo = tipo;
		this.periodoAncora = new Date();

		if (tipo !== "personalizado") {
			this.seletorPeriodoAberto = false;
			this.atualizarPeriodo();
		}
	}

	aplicarPeriodoPersonalizado(): void {
		if (!this.personalizadoInicio || !this.personalizadoFim) {
			return;
		}

		this.seletorPeriodoAberto = false;
		this.atualizarPeriodo();
	}

	/**
	 * O período (hoje/semana/mês/.../personalizado) é compartilhado pelas
	 * abas Categorias e Tags — muda num lugar, recarrega os dois.
	 */
	private atualizarPeriodo(): void {
		this.carregarRelatorio();
		this.carregarRelatorioTags();
	}

	// =====================================================================
	// CARREGAMENTO / AGRUPAMENTO
	// =====================================================================

	private formatarISO(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const dia = String(d.getDate()).padStart(2, "0");
		return `${y}-${m}-${dia}`;
	}

	async carregarRelatorio(): Promise<void> {
		this.carregando = true;

		const { inicio, fim } = this.intervalo;
		const inicioISO = this.formatarISO(inicio);
		const fimISO = this.formatarISO(fim);

		const categorias = await this.db.query<CategoriaRow>(
			`SELECT id, nome, tipo, icone, cor, categoria_pai_id
       FROM categorias
       WHERE usuario_id = ?`,
			[USUARIO_LOCAL_ID],
		);
		this.categoriasPorId = new Map(categorias.map((c) => [c.id, c]));

		const lancamentos = await this.db.query<LancamentoRow>(
			`SELECT id, categoria_id, descricao, valor, tipo, data
       FROM lancamentos
       WHERE usuario_id = ? AND data >= ? AND data <= ?`,
			[USUARIO_LOCAL_ID, inicioISO, fimISO],
		);

		this.despesas = this.montarLinhas(
			lancamentos.filter((l) => l.tipo === "despesa"),
		);
		this.receitas = this.montarLinhas(
			lancamentos.filter((l) => l.tipo === "receita"),
		);

		this.totalDespesas = this.despesas.reduce((soma, l) => soma + l.valor, 0);
		this.totalReceitas = this.receitas.reduce((soma, l) => soma + l.valor, 0);

		this.carregando = false;

		// Os containers dos gráficos só existem no DOM depois que o Angular
		// termina de re-renderizar (carregando passou pra false agora mesmo).
		setTimeout(() => this.renderizarGraficos(), 0);
	}

	/**
	 * Agrupa os lançamentos de um tipo (despesa OU receita) por categoria
	 * principal, calculando também a quebra entre "lançado direto na
	 * categoria pai" e "lançado em cada sub-categoria" quando os dois
	 * casos aparecem juntos no período.
	 */
	private montarLinhas(lancamentos: LancamentoRow[]): LinhaCategoria[] {
		const grupos = new Map<
			string,
			{ categoriaPai: CategoriaRow | null; itens: LancamentoRow[] }
		>();

		for (const l of lancamentos) {
			const categoria = l.categoria_id
				? (this.categoriasPorId.get(l.categoria_id) ?? null)
				: null;

			const paiId = categoria
				? (categoria.categoria_pai_id ?? categoria.id)
				: "sem-categoria";

			if (!grupos.has(paiId)) {
				let categoriaPai: CategoriaRow | null = null;

				if (categoria) {
					categoriaPai = categoria.categoria_pai_id
						? (this.categoriasPorId.get(categoria.categoria_pai_id) ?? null)
						: categoria;
				}

				grupos.set(paiId, { categoriaPai, itens: [] });
			}

			grupos.get(paiId)!.itens.push(l);
		}

		const totalGeral = lancamentos.reduce((soma, l) => soma + l.valor, 0);
		const linhas: LinhaCategoria[] = [];

		for (const [paiId, grupo] of grupos) {
			const valor = grupo.itens.reduce((soma, l) => soma + l.valor, 0);

			const nome = grupo.categoriaPai
				? grupo.categoriaPai.nome
				: "Sem categoria";
			const icone = grupo.categoriaPai?.icone ?? "help_outline";
			const cor =
				grupo.categoriaPai?.cor ||
				PALETA_PADRAO[linhas.length % PALETA_PADRAO.length];

			const diretos = grupo.itens.filter(
				(l) => !l.categoria_id || l.categoria_id === paiId,
			);
			const doSubcategorias = grupo.itens.filter(
				(l) => l.categoria_id && l.categoria_id !== paiId,
			);

			const misturado = doSubcategorias.length > 0;
			const agrupamentos: Agrupamento[] = [];
			let transacoesDiretas: Transacao[] = [];

			if (doSubcategorias.length === 0) {
				// Só existem lançamentos direto na categoria: mostra a lista
				// "crua" das transações, sem a camada extra de agrupamento.
				transacoesDiretas = diretos.map((l) => ({
					id: l.id,
					descricao: l.descricao || "(sem descrição)",
					valor: l.valor,
				}));
			} else {
				// Tem sub-categoria envolvida: agrupa por categoria_id real
				// (a própria categoria pai entra como um grupo "(categoria pai)"
				// quando também recebeu lançamentos direto).
				const porSubcategoria = new Map<string, LancamentoRow[]>();

				if (diretos.length) {
					porSubcategoria.set(paiId, diretos);
				}

				for (const l of doSubcategorias) {
					const chave = l.categoria_id as string;
					if (!porSubcategoria.has(chave)) {
						porSubcategoria.set(chave, []);
					}
					porSubcategoria.get(chave)!.push(l);
				}

				for (const [chave, itens] of porSubcategoria) {
					const subCategoria = this.categoriasPorId.get(chave);
					const rotulo =
						chave === paiId
							? `${nome}`
							: (subCategoria?.nome ?? "-");

					agrupamentos.push({
						chave,
						rotulo,
						valor: itens.reduce((soma, l) => soma + l.valor, 0),
						transacoes: itens.map((l) => ({
							id: l.id,
							descricao: l.descricao || "(sem descrição)",
							valor: l.valor,
						})),
					});
				}
			}

			linhas.push({
				categoriaId: paiId,
				nome,
				icone,
				cor,
				valor,
				percentual: totalGeral > 0 ? (valor / totalGeral) * 100 : 0,
				misturado,
				agrupamentos,
				transacoesDiretas,
				expandida: false,
			});
		}

		return linhas.sort((a, b) => b.valor - a.valor);
	}

	alternarExpansao(linha: LinhaCategoria): void {
		linha.expandida = !linha.expandida;
	}

	// =====================================================================
	// GRÁFICOS (ECharts)
	// =====================================================================

	private renderizarGraficos(): void {
		this.renderizarDonut(
			this.graficoDespesasRef?.nativeElement,
			this.despesas,
			"despesas",
		);
		this.renderizarDonut(
			this.graficoReceitasRef?.nativeElement,
			this.receitas,
			"receitas",
		);
	}

	private renderizarDonut(
		elemento: HTMLDivElement | undefined,
		linhas: LinhaCategoria[],
		chave: "despesas" | "receitas",
	): void {
		if (!elemento) {
			return;
		}

		let chart = this.charts[chave];

		/*
		 * Proteção defensiva: se por algum motivo a instância guardada
		 * estiver presa a um elemento que já saiu do DOM (ou foi disposed),
		 * ela precisa ser descartada e recriada em cima do elemento atual.
		 * Na prática não deveria mais acontecer — os containers usam
		 * [hidden] em vez de *ngIf, então nunca são destruídos/recriados.
		 */
		if (chart && (chart.isDisposed() || chart.getDom() !== elemento)) {
			chart.dispose();
			chart = null;
		}

		if (!chart) {
			chart = echarts.init(elemento);
			this.charts[chave] = chart;
		}

		chart.setOption({
			tooltip: {
				trigger: "item",
				formatter: (parametros: any) =>
					`${parametros.name}<br/><strong>${parametros.percent}%</strong>`,
			},
			series: [
				{
					type: "pie",
					radius: ["55%", "80%"],
					avoidLabelOverlap: false,
					label: { show: false },
					labelLine: { show: false },
					data: linhas.map((l) => ({
						name: l.nome,
						value: Number(l.valor.toFixed(2)),
						itemStyle: { color: l.cor },
					})),
				},
			],
		});

		chart.resize();
	}

	// =====================================================================
	// EVOLUÇÃO ANUAL (aba "Entradas x Saídas")
	// =====================================================================

	anoEvolucaoAnterior(): void {
		this.anoEvolucao--;
		this.carregarEvolucaoAnual();
	}

	anoEvolucaoProximo(): void {
		this.anoEvolucao++;
		this.carregarEvolucaoAnual();
	}

	async carregarEvolucaoAnual(): Promise<void> {
		this.carregandoEvolucao = true;

		const inicio = `${this.anoEvolucao}-01-01`;
		const fim = `${this.anoEvolucao}-12-31`;

		const linhas = await this.db.query<{ mes: string; tipo: string; total: number }>(
			`SELECT substr(data, 6, 2) as mes, tipo, SUM(valor) as total
       FROM lancamentos
       WHERE usuario_id = ? AND data >= ? AND data <= ?
       GROUP BY mes, tipo`,
			[USUARIO_LOCAL_ID, inicio, fim],
		);

		const resumo: MesResumo[] = Array.from({ length: 12 }, (_, i) => ({
			mes: i + 1,
			receitas: 0,
			despesas: 0,
			saldo: 0,
		}));

		for (const linha of linhas) {
			const indice = Number(linha.mes) - 1;

			if (indice < 0 || indice > 11) {
				continue;
			}

			if (linha.tipo === "receita") {
				resumo[indice].receitas = Number(linha.total);
			} else if (linha.tipo === "despesa") {
				resumo[indice].despesas = Number(linha.total);
			}
		}

		for (const item of resumo) {
			item.saldo = item.receitas - item.despesas;
		}

		this.resumoMensal = resumo;
		this.mesesComDados = resumo.filter((m) => m.receitas > 0 || m.despesas > 0);

		let acumulado = 0;
		this.saldoAcumuladoSerie = resumo.map((m) => {
			acumulado += m.saldo;
			return acumulado;
		});

		this.totalReceitasAno = resumo.reduce((soma, m) => soma + m.receitas, 0);
		this.totalDespesasAno = resumo.reduce((soma, m) => soma + m.despesas, 0);
		this.saldoAno = this.totalReceitasAno - this.totalDespesasAno;

		this.melhorMes = this.mesesComDados.length
			? this.mesesComDados.reduce((melhor, atual) =>
				atual.saldo > melhor.saldo ? atual : melhor,
			)
			: null;

		const qtd = this.mesesComDados.length || 1;
		this.mediaReceitas =
			this.mesesComDados.reduce((soma, m) => soma + m.receitas, 0) / qtd;
		this.mediaDespesas =
			this.mesesComDados.reduce((soma, m) => soma + m.despesas, 0) / qtd;
		this.mediaSaldo =
			this.mesesComDados.reduce((soma, m) => soma + m.saldo, 0) / qtd;

		this.carregandoEvolucao = false;

		// Mesma razão do setTimeout em carregarRelatorio(): os containers só
		// existem no DOM depois que o Angular termina de re-renderizar.
		setTimeout(() => this.renderizarGraficosEvolucao(), 0);
	}

	nomeMesAbrev(mes: number): string {
		return NOMES_MES_ABREV[mes - 1];
	}

	nomeMesCompleto(mes: number): string {
		return NOMES_MES_COMPLETO[mes - 1];
	}

	rotuloPeriodoEvolucao(): string {
		if (!this.mesesComDados.length) {
			return `${this.anoEvolucao}`;
		}

		const primeiro = this.mesesComDados[0].mes;
		const ultimo = this.mesesComDados[this.mesesComDados.length - 1].mes;

		return primeiro === ultimo
			? `${this.anoEvolucao} · ${this.nomeMesCompleto(primeiro)}`
			: `${this.anoEvolucao} · ${this.nomeMesCompleto(primeiro)}–${this.nomeMesCompleto(ultimo)}`;
	}

	statusSaldo(saldo: number): "superavit" | "deficit" | "equilibrado" {
		if (saldo > 0) return "superavit";
		if (saldo < 0) return "deficit";
		return "equilibrado";
	}

	rotuloStatus(saldo: number): string {
		switch (this.statusSaldo(saldo)) {
			case "superavit":
				return "Superávit";
			case "deficit":
				return "Déficit";
			default:
				return "Equilibrado";
		}
	}

	private renderizarGraficosEvolucao(): void {
		this.renderizarComparativo(this.graficoComparativoRef?.nativeElement);
		this.renderizarAcumulado(this.graficoAcumuladoRef?.nativeElement);
	}

	private renderizarComparativo(elemento: HTMLDivElement | undefined): void {
		if (!elemento) {
			return;
		}

		let chart = this.charts.comparativo;

		if (chart && (chart.isDisposed() || chart.getDom() !== elemento)) {
			chart.dispose();
			chart = null;
		}

		if (!chart) {
			chart = echarts.init(elemento);
			this.charts.comparativo = chart;
		}

		chart.setOption({
			tooltip: { trigger: "axis" },
			legend: { data: ["Receitas", "Despesas"], bottom: 0 },
			grid: { left: 48, right: 16, top: 24, bottom: 40 },
			xAxis: {
				type: "category",
				data: NOMES_MES_ABREV,
				boundaryGap: false,
			},
			yAxis: {
				type: "value",
				axisLabel: { formatter: (v: number) => `R$ ${v / 1000}k` },
			},
			series: [
				{
					name: "Receitas",
					type: "line",
					data: this.resumoMensal.map((m) => Number(m.receitas.toFixed(2))),
					color: COR_RECEITA,
					symbolSize: 7,
					lineStyle: { width: 2 },
				},
				{
					name: "Despesas",
					type: "line",
					data: this.resumoMensal.map((m) => Number(m.despesas.toFixed(2))),
					color: COR_DESPESA,
					symbolSize: 7,
					lineStyle: { width: 2 },
				},
			],
		});

		chart.resize();
	}

	private renderizarAcumulado(elemento: HTMLDivElement | undefined): void {
		if (!elemento) {
			return;
		}

		let chart = this.charts.acumulado;

		if (chart && (chart.isDisposed() || chart.getDom() !== elemento)) {
			chart.dispose();
			chart = null;
		}

		if (!chart) {
			chart = echarts.init(elemento);
			this.charts.acumulado = chart;
		}

		chart.setOption({
			tooltip: { trigger: "axis" },
			grid: { left: 48, right: 16, top: 24, bottom: 24 },
			xAxis: {
				type: "category",
				data: NOMES_MES_ABREV,
				boundaryGap: false,
			},
			yAxis: {
				type: "value",
				axisLabel: { formatter: (v: number) => `R$ ${v / 1000}k` },
			},
			series: [
				{
					name: "Saldo acumulado",
					type: "line",
					data: this.saldoAcumuladoSerie.map((v) => Number(v.toFixed(2))),
					color: COR_RECEITA,
					symbolSize: 7,
					lineStyle: { width: 2 },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: "rgba(60, 122, 60, 0.35)" },
							{ offset: 1, color: "rgba(60, 122, 60, 0.02)" },
						]),
					},
				},
			],
		});

		chart.resize();
	}

	// =====================================================================
	// RELATÓRIO DE CONTA (aba "Contas")
	// =====================================================================
	//
	// Estrutura quase igual à Evolução Anual (navegador de ano, cards,
	// gráfico mensal) — a diferença principal é o filtro por UMA conta em
	// vez do total geral, e a lista de lançamentos com saldo acumulado no
	// final.

	private async carregarContasDisponiveis(): Promise<void> {
		this.contas = await this.db.query<ContaRow>(
			`SELECT id, nome, saldo_inicial FROM contas WHERE usuario_id = ? ORDER BY nome`,
			[USUARIO_LOCAL_ID],
		);

		if (!this.contaSelecionadaId && this.contas.length) {
			this.contaSelecionadaId = this.contas[0].id;
		}
	}

	async selecionarConta(contaId: string): Promise<void> {
		this.contaSelecionadaId = contaId;
		await this.carregarRelatorioConta();
	}

	anoContaAnterior(): void {
		this.anoConta--;
		this.carregarRelatorioConta();
	}

	anoContaProximo(): void {
		this.anoConta++;
		this.carregarRelatorioConta();
	}

	async carregarRelatorioConta(): Promise<void> {
		if (!this.contaSelecionadaId) {
			this.lancamentosConta = [];
			this.resumoMensalConta = [];
			this.mesesComDadosContaCount = 0;
			this.totalEntradasConta = 0;
			this.totalSaidasConta = 0;
			this.saldoAtualConta = 0;
			return;
		}

		this.carregandoConta = true;

		const conta = this.contas.find((c) => c.id === this.contaSelecionadaId);

		// Saldo real (all-time, só confirmados) — mesma regra de
		// obterSaldoConta(), pra bater com o que a Visão Geral mostra.
		this.saldoAtualConta = await this.db.obterSaldoConta(this.contaSelecionadaId);

		if (!this.categoriasPorId.size) {
			const categorias = await this.db.query<CategoriaRow>(
				`SELECT id, nome, tipo, icone, cor, categoria_pai_id FROM categorias WHERE usuario_id = ?`,
				[USUARIO_LOCAL_ID],
			);
			this.categoriasPorId = new Map(categorias.map((c) => [c.id, c]));
		}

		// Todo o histórico confirmado da conta, mais antigo primeiro — é o
		// que dá pra calcular o saldo acumulado corretamente (ele parte do
		// saldo_inicial e cresce/diminui em ordem cronológica real, não só
		// dentro do ano selecionado).
		const todos = await this.db.query<LancamentoContaRow>(
			`SELECT id, data, descricao, valor, tipo, categoria_id
       FROM lancamentos
       WHERE usuario_id = ? AND conta_id = ? AND confirmado = 1
       ORDER BY data ASC`,
			[USUARIO_LOCAL_ID, this.contaSelecionadaId],
		);

		const tagsPorLancamento = await this.db.obterTagsPorLancamentos(
			todos.map((l) => l.id),
		);

		let acumulado = conta?.saldo_inicial ?? 0;

		const comSaldo: LancamentoConta[] = todos.map((l) => {
			acumulado += l.tipo === "receita" ? l.valor : -l.valor;

			return {
				id: l.id,
				data: l.data,
				descricao: l.descricao || "(sem descrição)",
				valor: l.valor,
				tipo: l.tipo as "receita" | "despesa",
				categoriaNome: l.categoria_id
					? (this.categoriasPorId.get(l.categoria_id)?.nome ?? "Sem categoria")
					: "Sem categoria",
				tagsNomes: (tagsPorLancamento[l.id] ?? []).map((t) => t.nome),
				saldoAcumulado: acumulado,
			};
		});

		const prefixoAno = `${this.anoConta}`;

		// Mais recente primeiro na lista, mantendo o saldo acumulado já
		// calculado cronologicamente.
		this.lancamentosConta = comSaldo
			.filter((l) => l.data.startsWith(prefixoAno))
			.slice()
			.reverse();

		const doAno = todos.filter((l) => l.data.startsWith(prefixoAno));

		const resumo: MesResumo[] = Array.from({ length: 12 }, (_, i) => ({
			mes: i + 1,
			receitas: 0,
			despesas: 0,
			saldo: 0,
		}));

		for (const l of doAno) {
			const indice = Number(l.data.substring(5, 7)) - 1;

			if (indice < 0 || indice > 11) {
				continue;
			}

			if (l.tipo === "receita") {
				resumo[indice].receitas += l.valor;
			} else {
				resumo[indice].despesas += l.valor;
			}
		}

		for (const item of resumo) {
			item.saldo = item.receitas - item.despesas;
		}

		this.resumoMensalConta = resumo;
		this.mesesComDadosContaCount = resumo.filter(
			(m) => m.receitas > 0 || m.despesas > 0,
		).length;
		this.totalEntradasConta = resumo.reduce((soma, m) => soma + m.receitas, 0);
		this.totalSaidasConta = resumo.reduce((soma, m) => soma + m.despesas, 0);

		this.carregandoConta = false;

		setTimeout(() => this.renderizarGraficoConta(), 0);
	}

	nomeContaSelecionada(): string {
		return this.contas.find((c) => c.id === this.contaSelecionadaId)?.nome ?? "";
	}

	private renderizarGraficoConta(): void {
		const elemento = this.graficoContaRef?.nativeElement;

		if (!elemento) {
			return;
		}

		let chart = this.charts.conta;

		if (chart && (chart.isDisposed() || chart.getDom() !== elemento)) {
			chart.dispose();
			chart = null;
		}

		if (!chart) {
			chart = echarts.init(elemento);
			this.charts.conta = chart;
		}

		chart.setOption({
			tooltip: { trigger: "axis" },
			legend: { data: ["Entradas", "Saídas"], bottom: 0 },
			grid: { left: 48, right: 16, top: 24, bottom: 40 },
			xAxis: {
				type: "category",
				data: NOMES_MES_ABREV,
			},
			yAxis: {
				type: "value",
				axisLabel: { formatter: (v: number) => `R$ ${v / 1000}k` },
			},
			series: [
				{
					name: "Entradas",
					type: "bar",
					data: this.resumoMensalConta.map((m) => Number(m.receitas.toFixed(2))),
					color: COR_RECEITA,
				},
				{
					name: "Saídas",
					type: "bar",
					data: this.resumoMensalConta.map((m) => Number(m.despesas.toFixed(2))),
					color: COR_DESPESA,
				},
			],
		});

		chart.resize();
	}

	// =====================================================================
	// RELATÓRIO DE TAGS (aba "Tags")
	// =====================================================================

	async carregarRelatorioTags(): Promise<void> {
		this.carregandoTags = true;

		const { inicio, fim } = this.intervalo;
		const inicioISO = this.formatarISO(inicio);
		const fimISO = this.formatarISO(fim);

		const linhas = await this.db.query<{
			id: string;
			data: string;
			descricao: string | null;
			valor: number;
			origemNome: string | null;
			tagId: string;
			tagNome: string;
		}>(
			`SELECT
         l.id, l.data, l.descricao, l.valor,
         COALESCE(c.nome, cc.nome, '-') as origemNome,
         t.id as tagId, t.nome as tagNome
       FROM lancamentos l
       JOIN lancamentos_tags lt ON lt.lancamento_id = l.id
       JOIN tags t ON t.id = lt.tag_id
       LEFT JOIN contas c ON c.id = l.conta_id
       LEFT JOIN cartoes_credito cc ON cc.id = l.cartao_id
       WHERE l.usuario_id = ? AND l.tipo = 'despesa' AND l.data >= ? AND l.data <= ?
       ORDER BY l.data DESC`,
			[USUARIO_LOCAL_ID, inicioISO, fimISO],
		);

		const grupos = new Map<string, { nome: string; itens: typeof linhas }>();

		for (const linha of linhas) {
			if (!grupos.has(linha.tagId)) {
				grupos.set(linha.tagId, { nome: linha.tagNome, itens: [] });
			}

			grupos.get(linha.tagId)!.itens.push(linha);
		}

		const linhasTag: LinhaTag[] = Array.from(grupos.entries()).map(
			([tagId, grupo], indice) => {
				const valor = grupo.itens.reduce((soma, l) => soma + Number(l.valor), 0);

				return {
					tagId,
					nome: grupo.nome,
					cor: PALETA_PADRAO[indice % PALETA_PADRAO.length],
					valor,
					percentual: 0,
					transacoes: grupo.itens.map((l) => ({
						id: l.id,
						data: l.data,
						descricao: l.descricao || "(sem descrição)",
						origemNome: l.origemNome || "-",
						valor: Number(l.valor),
						percentualDaTag: valor > 0 ? (Number(l.valor) / valor) * 100 : 0,
					})),
					expandida: false,
				};
			},
		);

		linhasTag.sort((a, b) => b.valor - a.valor);

		const total = linhasTag.reduce((soma, l) => soma + l.valor, 0);

		for (const linha of linhasTag) {
			linha.percentual = total > 0 ? (linha.valor / total) * 100 : 0;
		}

		this.linhasTag = linhasTag;
		this.totalComTags = total;

		this.carregandoTags = false;
	}

	alternarExpansaoTag(linha: LinhaTag): void {
		linha.expandida = !linha.expandida;
	}

	// =====================================================================
	// FORMATAÇÃO
	// =====================================================================

	formatarMoeda(valor: number): string {
		return valor.toLocaleString("pt-BR", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	}

	formatarPercentual(valor: number): string {
		return (
			valor.toLocaleString("pt-BR", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}) + "%"
		);
	}
}
