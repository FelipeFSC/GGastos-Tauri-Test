import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import * as echarts from "echarts";
import { DatabaseService, USUARIO_LOCAL_ID, FaturaResumoPeriodo } from "../../services/database.service";

interface Conta {
  id: string;
  nome: string;
  icone: string | null;
  cor: string | null;
  nao_somar_saldo: number;
}

interface Cartao {
  id: string;
  nome: string;
  icone: string | null;
  cor: string | null;
  limite: number;
  dia_vencimento: number;
}

interface ContaResumo extends Conta {
  saldo: number;
}

interface CartaoResumo extends Cartao {
  faturaTotal: number;
  faturaVencimento: string | null;
  limiteDisponivel: number;
}

interface ContaAPagar {
  id: string;
  descricao: string | null;
  valor: number;
  data: string;
  icone: string | null;
  cor: string | null;
  /** Setado quando o item representa a fatura de um cartão (não um lançamento avulso). */
  faturaId?: string;
}

interface GastoCategoria {
  categoria_id: string;
  nome: string;
  cor: string | null;
  total: number;
  percentual: number;
}

interface LimiteResumo {
  id: string;
  categoria_id: string;
  nome: string;
  icone: string | null;
  cor: string | null;
  valor_limite: number;
  gasto: number;
}

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

@Component({
  selector: "app-visao-geral",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./visao-geral.component.html",
  styleUrl: "./visao-geral.component.css",
})
export class VisaoGeralComponent implements OnInit, OnDestroy {
  @ViewChild("graficoCategorias")
  graficoCategoriasRef?: ElementRef<HTMLDivElement>;

  mes = new Date().getMonth() + 1;
  ano = new Date().getFullYear();

  saudacao = "";

  receitasMes = 0;
  despesasMes = 0;
  saldoGeral = 0;
  faturasMes = 0;

  mostrarSaldo = true;
  mostrarFaturas = true;

  contas: ContaResumo[] = [];
  cartoes: CartaoResumo[] = [];
  contasAPagar: ContaAPagar[] = [];
  contasAReceber: ContaAPagar[] = [];
  topCategorias: GastoCategoria[] = [];
  limitesResumo: LimiteResumo[] = [];

  /** Preferência de quais cards o usuário fechou — persistida no localStorage. */
  cardsFechados: Record<string, boolean> = {};

  /** Raio/circunferência do anel de progresso dos limites (SVG, viewBox 0 0 40 40). */
  readonly ringCircunferencia = 2 * Math.PI * 16;

  private chartCategorias: echarts.ECharts | null = null;
  private readonly CHAVE_CARDS_FECHADOS = "ggastos.visaoGeral.cardsFechados";

  get nomeMes(): string {
    return NOMES_MES[this.mes - 1];
  }

  constructor(private db: DatabaseService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    this.saudacao = this.obterSaudacao();
    this.carregarPreferenciaCards();
    await this.carregar();
  }

  ngOnDestroy(): void {
    this.chartCategorias?.dispose();
  }

  @HostListener("window:resize")
  onResize(): void {
    if (this.chartCategorias && !this.chartCategorias.isDisposed()) {
      this.chartCategorias.resize();
    }
  }

  private obterSaudacao(): string {
    const hora = new Date().getHours();
    if (hora < 12) return "Bom dia";
    if (hora < 18) return "Boa tarde";
    return "Boa noite";
  }

  private periodo(): { inicio: string; fim: string } {
    const mm = String(this.mes).padStart(2, "0");
    const ultimoDia = new Date(this.ano, this.mes, 0).getDate();
    return {
      inicio: `${this.ano}-${mm}-01`,
      fim: `${this.ano}-${mm}-${String(ultimoDia).padStart(2, "0")}`,
    };
  }

  async mesAnterior(): Promise<void> {
    this.mes -= 1;
    if (this.mes < 1) {
      this.mes = 12;
      this.ano -= 1;
    }
    await this.carregar();
  }

  async mesProximo(): Promise<void> {
    this.mes += 1;
    if (this.mes > 12) {
      this.mes = 1;
      this.ano += 1;
    }
    await this.carregar();
  }

  async carregar(): Promise<void> {
    const { inicio, fim } = this.periodo();

    await Promise.all([
      this.carregarTotais(inicio, fim),
      this.carregarContas(),
      this.carregarCartoes(),
      this.carregarContasAPagar(inicio, fim),
      this.carregarContasAReceber(inicio, fim),
      this.carregarTopCategorias(inicio, fim),
      this.carregarLimitesResumo(),
    ]);
  }

  private async carregarTotais(inicio: string, fim: string): Promise<void> {
    this.receitasMes = await this.db.obterTotalReceitas(inicio, fim);
    this.despesasMes = await this.db.obterTotalDespesas(inicio, fim);
  }

  private async carregarContas(): Promise<void> {
    const contas = await this.db.query<Conta>("SELECT * FROM contas WHERE ativo = 1 ORDER BY nome");

    const comSaldo: ContaResumo[] = [];
    let saldoGeral = 0;

    for (const conta of contas) {
      const saldo = await this.db.obterSaldoConta(conta.id);
      comSaldo.push({ ...conta, saldo });
      if (!conta.nao_somar_saldo) saldoGeral += saldo;
    }

    this.contas = comSaldo;
    this.saldoGeral = saldoGeral;
  }

  private async carregarCartoes(): Promise<void> {
    const cartoes = await this.db.query<Cartao>("SELECT * FROM cartoes_credito WHERE ativo = 1 ORDER BY nome");

    const comFatura: CartaoResumo[] = [];
    let faturasMes = 0;

    for (const cartao of cartoes) {
      const faturas = await this.db.query<{ total: number; data_vencimento: string }>(
        `SELECT f.data_vencimento,
                COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.fatura_id = f.id), 0) as total
         FROM faturas f
         WHERE f.cartao_id = ? AND f.mes_referencia = ? AND f.ano_referencia = ?`,
        [cartao.id, this.mes, this.ano]
      );

      const total = Number(faturas[0]?.total ?? 0);
      const vencimento = faturas[0]?.data_vencimento ?? null;

      comFatura.push({
        ...cartao,
        faturaTotal: total,
        faturaVencimento: vencimento,
        limiteDisponivel: cartao.limite - total,
      });

      faturasMes += total;
    }

    this.cartoes = comFatura;
    this.faturasMes = faturasMes;
  }

  private async carregarContasAPagar(inicio: string, fim: string): Promise<void> {
    // Compras no cartão não entram aqui como lançamentos avulsos — elas
    // viram 1 item só (a fatura), igual a listagem de Lançamentos.
    const lancamentos = await this.db.query<ContaAPagar>(
      `SELECT l.id, l.descricao, l.valor, l.data, c.icone, c.cor
       FROM lancamentos l
       LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.usuario_id = ? AND l.tipo = 'despesa' AND l.confirmado = 0
         AND l.cartao_id IS NULL AND l.data BETWEEN ? AND ?
       ORDER BY l.data ASC`,
      [USUARIO_LOCAL_ID, inicio, fim]
    );

    const primeiroDiaProximoMes = this.formatarData(new Date(this.ano, this.mes, 1));

    const faturas = await this.db.listarFaturasPorVencimento(inicio, primeiroDiaProximoMes);

    const faturasEmAberto: ContaAPagar[] = faturas
      .filter((f) => f.valorRestante > 0.01)
      .map((f) => this.faturaComoContaAPagar(f));

    this.contasAPagar = [...lancamentos, ...faturasEmAberto].sort((a, b) =>
      a.data.localeCompare(b.data)
    );
  }

  private faturaComoContaAPagar(fatura: FaturaResumoPeriodo): ContaAPagar {
    return {
      id: fatura.id,
      descricao: `Fatura ${NOMES_MES[fatura.mes_referencia - 1]} ${fatura.ano_referencia}`,
      valor: fatura.valorRestante,
      data: fatura.data_vencimento,
      icone: fatura.cartao_icone,
      cor: fatura.cartao_cor,
      faturaId: fatura.id,
    };
  }

  private async carregarContasAReceber(inicio: string, fim: string): Promise<void> {
    this.contasAReceber = await this.db.query<ContaAPagar>(
      `SELECT l.id, l.descricao, l.valor, l.data, c.icone, c.cor
       FROM lancamentos l
       LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.usuario_id = ? AND l.tipo = 'receita' AND l.confirmado = 0
         AND l.cartao_id IS NULL AND l.data BETWEEN ? AND ?
       ORDER BY l.data ASC`,
      [USUARIO_LOCAL_ID, inicio, fim]
    );
  }

  private formatarData(data: Date): string {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }

  private async carregarTopCategorias(inicio: string, fim: string): Promise<void> {
    const linhas = await this.db.query<{ categoria_id: string; nome: string; cor: string | null; total: number }>(
      `SELECT l.categoria_id, c.nome, c.cor, SUM(l.valor) as total
       FROM lancamentos l
       JOIN categorias c ON c.id = l.categoria_id
       WHERE l.usuario_id = ? AND l.tipo = 'despesa' AND l.data BETWEEN ? AND ?
       GROUP BY l.categoria_id
       ORDER BY total DESC
       LIMIT 5`,
      [USUARIO_LOCAL_ID, inicio, fim]
    );

    const totalGeral = linhas.reduce((soma, l) => soma + Number(l.total), 0) || 1;

    this.topCategorias = linhas.map((l) => ({
      categoria_id: l.categoria_id,
      nome: l.nome,
      cor: l.cor,
      total: Number(l.total),
      percentual: (Number(l.total) / totalGeral) * 100,
    }));

    this.renderizarDonutCategorias();
  }

  // =====================================================================
  // GRÁFICO — TOP CATEGORIAS (ECharts)
  // =====================================================================

  private renderizarDonutCategorias(): void {
    const elemento = this.graficoCategoriasRef?.nativeElement;

    if (!elemento) {
      return;
    }

    if (
      this.chartCategorias &&
      (this.chartCategorias.isDisposed() || this.chartCategorias.getDom() !== elemento)
    ) {
      this.chartCategorias.dispose();
      this.chartCategorias = null;
    }

    if (!this.chartCategorias) {
      this.chartCategorias = echarts.init(elemento);
    }

    // Sem rótulos no gráfico em si — ele é pequeno e fica ao lado da
    // legenda (que já mostra nome + percentual), rótulos aqui só
    // sobrepõem uns aos outros. O detalhe aparece no tooltip ao passar
    // o mouse.
    this.chartCategorias.setOption({
      tooltip: {
        trigger: "item",
        formatter: (parametros: any) =>
          `${parametros.name}<br/><strong>${parametros.percent}%</strong>`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "85%"],
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          data: this.topCategorias.map((c) => ({
            name: c.nome,
            value: Number(c.total.toFixed(2)),
            itemStyle: { color: c.cor || "#9aa0a6" },
          })),
        },
      ],
    });

    this.chartCategorias.resize();
  }

  // =====================================================================
  // LIMITES DO MÊS
  // =====================================================================

  private async carregarLimitesResumo(): Promise<void> {
    const limites = await this.db.query<{
      id: string;
      categoria_id: string;
      valor_limite: number;
      nome: string;
      icone: string | null;
      cor: string | null;
    }>(
      `SELECT l.id, l.categoria_id, l.valor_limite, c.nome, c.icone, c.cor
       FROM limites_gastos l
       JOIN categorias c ON c.id = l.categoria_id
       WHERE l.usuario_id = ? AND l.mes = ? AND l.ano = ?
       ORDER BY c.nome`,
      [USUARIO_LOCAL_ID, this.mes, this.ano]
    );

    const resumo: LimiteResumo[] = [];

    for (const limite of limites) {
      const resultado = await this.db.query<{ gasto: number }>(
        `SELECT COALESCE(SUM(valor), 0) AS gasto
         FROM lancamentos
         WHERE usuario_id = ?
           AND tipo = 'despesa'
           AND CAST(strftime('%m', data) AS INTEGER) = ?
           AND CAST(strftime('%Y', data) AS INTEGER) = ?
           AND (
             categoria_id = ?
             OR categoria_id IN (
               SELECT id FROM categorias WHERE categoria_pai_id = ?
             )
           )`,
        [USUARIO_LOCAL_ID, this.mes, this.ano, limite.categoria_id, limite.categoria_id]
      );

      resumo.push({
        id: limite.id,
        categoria_id: limite.categoria_id,
        nome: limite.nome,
        icone: limite.icone,
        cor: limite.cor,
        valor_limite: Number(limite.valor_limite),
        gasto: Number(resultado[0]?.gasto ?? 0),
      });
    }

    this.limitesResumo = resumo;
  }

  /** Percentual real (sem limitar em 100) — usado no texto exibido. */
  percentualLimite(limite: LimiteResumo): number {
    if (!limite.valor_limite || limite.valor_limite <= 0) {
      return 0;
    }

    return (limite.gasto / limite.valor_limite) * 100;
  }

  classeLimite(limite: LimiteResumo): "safe" | "warning" | "danger" {
    const percentual = this.percentualLimite(limite);

    if (percentual > 80) {
      return "danger";
    }

    if (percentual > 70) {
      return "warning";
    }

    return "safe";
  }

  /** Deslocamento do traço do anel SVG — limitado em 100% (não "estoura" visualmente). */
  ringDashOffset(limite: LimiteResumo): number {
    const percentual = Math.min(this.percentualLimite(limite), 100);

    return this.ringCircunferencia - (this.ringCircunferencia * percentual) / 100;
  }

  // =====================================================================
  // CARDS RECOLHÍVEIS
  // =====================================================================

  private carregarPreferenciaCards(): void {
    try {
      const salvo = localStorage.getItem(this.CHAVE_CARDS_FECHADOS);
      this.cardsFechados = salvo ? JSON.parse(salvo) : {};
    } catch {
      this.cardsFechados = {};
    }
  }

  cardFechado(id: string): boolean {
    return !!this.cardsFechados[id];
  }

  toggleCard(id: string): void {
    this.cardsFechados[id] = !this.cardsFechados[id];

    try {
      localStorage.setItem(this.CHAVE_CARDS_FECHADOS, JSON.stringify(this.cardsFechados));
    } catch {
      // localStorage indisponível — a preferência só vale pra sessão atual.
    }

    /*
     * O card de "Top categorias" usa [hidden] em vez de *ngIf (pra não
     * destruir a instância do ECharts toda vez que fecha/abre) — o
     * ECharts não recalcula o próprio tamanho sozinho quando o container
     * volta a ficar visível, então força um resize depois que o Angular
     * aplicar a mudança de [hidden].
     */
    setTimeout(() => this.onResize(), 0);
  }

  novoLancamento(tipo: "despesa" | "receita"): void {
    this.router.navigate(["/lancamentos"], { queryParams: { novo: tipo } });
  }
}
