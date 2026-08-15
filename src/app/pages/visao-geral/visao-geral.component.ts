import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { DatabaseService, USUARIO_LOCAL_ID } from "../../services/database.service";

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
}

interface GastoCategoria {
  categoria_id: string;
  nome: string;
  cor: string | null;
  total: number;
  percentual: number;
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
export class VisaoGeralComponent implements OnInit {
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
  maioresGastos: GastoCategoria[] = [];

  get nomeMes(): string {
    return NOMES_MES[this.mes - 1];
  }

  constructor(private db: DatabaseService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    this.saudacao = this.obterSaudacao();
    await this.carregar();
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
      this.carregarMaioresGastos(inicio, fim),
    ]);
  }

  private async carregarTotais(inicio: string, fim: string): Promise<void> {
    this.receitasMes = await this.db.obterTotalReceitas(inicio, fim);
    this.despesasMes = await this.db.obterTotalDespesas(inicio, fim);
  }

  private async carregarContas(): Promise<void> {
    const contas = await this.db.query<Conta>("SELECT * FROM contas ORDER BY nome");

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
    const cartoes = await this.db.query<Cartao>("SELECT * FROM cartoes_credito ORDER BY nome");

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
    this.contasAPagar = await this.db.query<ContaAPagar>(
      `SELECT l.id, l.descricao, l.valor, l.data, c.icone, c.cor
       FROM lancamentos l
       LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.usuario_id = ? AND l.tipo = 'despesa' AND l.confirmado = 0 AND l.data BETWEEN ? AND ?
       ORDER BY l.data ASC`,
      [USUARIO_LOCAL_ID, inicio, fim]
    );
  }

  private async carregarMaioresGastos(inicio: string, fim: string): Promise<void> {
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

    this.maioresGastos = linhas.map((l) => ({
      categoria_id: l.categoria_id,
      nome: l.nome,
      cor: l.cor,
      total: Number(l.total),
      percentual: (Number(l.total) / totalGeral) * 100,
    }));
  }

  novoLancamento(tipo: "despesa" | "receita"): void {
    this.router.navigate(["/lancamentos"], { queryParams: { novo: tipo } });
  }
}
