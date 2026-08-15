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

	private categoriasPorId = new Map<string, CategoriaRow>();
	private charts: {
		despesas: echarts.ECharts | null;
		receitas: echarts.ECharts | null;
	} = { despesas: null, receitas: null };

	constructor(private db: DatabaseService) { }

	async ngOnInit(): Promise<void> {
		await this.carregarRelatorio();
	}

	ngAfterViewInit(): void {
		// Os gráficos são criados/atualizados em carregarRelatorio(), depois
		// que os dados chegam — aqui não tem nada pra fazer ainda.
	}

	ngOnDestroy(): void {
		this.charts.despesas?.dispose();
		this.charts.receitas?.dispose();
	}

	@HostListener("window:resize")
	onResize(): void {
		if (this.charts.despesas && !this.charts.despesas.isDisposed()) {
			this.charts.despesas.resize();
		}
		if (this.charts.receitas && !this.charts.receitas.isDisposed()) {
			this.charts.receitas.resize();
		}
	}

	// =====================================================================
	// ABAS
	// =====================================================================

	selecionarAba(aba: Aba): void {
		this.abaAtiva = aba;
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
		this.carregarRelatorio();
	}

	alternarSeletorPeriodo(): void {
		this.seletorPeriodoAberto = !this.seletorPeriodoAberto;
	}

	selecionarPeriodo(tipo: TipoPeriodo): void {
		this.periodoTipo = tipo;
		this.periodoAncora = new Date();

		if (tipo !== "personalizado") {
			this.seletorPeriodoAberto = false;
			this.carregarRelatorio();
		}
	}

	aplicarPeriodoPersonalizado(): void {
		if (!this.personalizadoInicio || !this.personalizadoFim) {
			return;
		}

		this.seletorPeriodoAberto = false;
		this.carregarRelatorio();
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
							? `${nome} (categoria pai)`
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
		 * O container é recriado do zero toda vez que "*ngIf=!carregando"
		 * alterna (troca de mês, de aba etc.) — o Angular destrói a <div>
		 * antiga e cria uma nova. Se a instância guardada ainda existir mas
		 * estiver presa a um elemento que já saiu do DOM (ou foi disposed),
		 * ela precisa ser descartada e recriada em cima do elemento atual.
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
