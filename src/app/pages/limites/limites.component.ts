import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DatabaseService,
  USUARIO_LOCAL_ID,
} from "../../services/database.service";

interface Categoria {
  id: string;
  nome: string;
  tipo: string;
  icone: string | null;
  cor: string | null;
  categoria_pai_id: string | null;
}

interface Limite {
  id: string;
  categoria_id: string;
  mes: number;
  ano: number;
  valor_limite: number;
  gasto: number;
}

@Component({
  selector: "app-limites",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./limites.component.html",
  styleUrl: "./limites.component.css",
})
export class LimitesComponent implements OnInit {
  limites: Limite[] = [];
  categorias: Categoria[] = [];
  categoriasPrincipais: Categoria[] = [];

  mes = new Date().getMonth() + 1;
  ano = new Date().getFullYear();

  categoriaId = "";
  valorLimite = 0;

  editandoId: string | null = null;

  constructor(private db: DatabaseService) {}

  async ngOnInit() {
    await this.carregar();
  }

  async carregar() {
    this.categorias = await this.db.query<Categoria>(
      "SELECT id, nome, tipo, icone, cor, categoria_pai_id FROM categorias ORDER BY nome"
    );

    // No formulário só faz sentido escolher a categoria "mãe": o gasto de
    // qualquer sub-categoria dela já entra automaticamente na soma.
    this.categoriasPrincipais = this.categorias.filter(
      (c) => !c.categoria_pai_id && c.tipo === "despesa"
    );

    await this.carregarLimites();
  }

  async carregarLimites() {
    const limites = await this.db.query<Limite>(
      `SELECT
        l.id,
        l.categoria_id,
        l.mes,
        l.ano,
        l.valor_limite
       FROM limites_gastos l
       WHERE l.usuario_id = ?
         AND l.mes = ?
         AND l.ano = ?
       ORDER BY l.categoria_id`,
      [USUARIO_LOCAL_ID, this.mes, this.ano]
    );

    this.limites = [];

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
        [
          USUARIO_LOCAL_ID,
          this.mes,
          this.ano,
          limite.categoria_id,
          limite.categoria_id,
        ]
      );

      limite.gasto = Number(resultado[0]?.gasto ?? 0);

      this.limites.push(limite);
    }
  }

  nomeCategoria(id: string): string {
    return (
      this.categorias.find((categoria) => categoria.id === id)?.nome ?? "-"
    );
  }

  iconeCategoria(id: string): string {
    return (
      this.categorias.find((categoria) => categoria.id === id)?.icone ||
      "category"
    );
  }

  corCategoria(id: string): string {
    return (
      this.categorias.find((categoria) => categoria.id === id)?.cor ||
      "#4285f4"
    );
  }

  percentual(limite: Limite): number {
    if (!limite.valor_limite || limite.valor_limite <= 0) {
      return 0;
    }

    const percentual = (limite.gasto / limite.valor_limite) * 100;

    return Math.min(percentual, 100);
  }

  classeProgresso(limite: Limite): string {
    const percentual = this.percentual(limite);

    if (percentual > 80) {
      return "danger";
    }

    if (percentual > 70) {
      return "warning";
    }

    return "safe";
  }

  valorRestante(limite: Limite): number {
    return Math.max(limite.valor_limite - limite.gasto, 0);
  }

  mesNome(): string {
    const data = new Date(this.ano, this.mes - 1, 1);

    return data.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  }

  async mesAnterior() {
    this.mes--;

    if (this.mes < 1) {
      this.mes = 12;
      this.ano--;
    }

    this.cancelarEdicao();
    await this.carregarLimites();
  }

  async proximoMes() {
    this.mes++;

    if (this.mes > 12) {
      this.mes = 1;
      this.ano++;
    }

    this.cancelarEdicao();
    await this.carregarLimites();
  }

  iniciarAdicao() {
    this.editandoId = null;
    this.categoriaId = "";
    this.valorLimite = 0;
  }

  iniciarEdicao(limite: Limite) {
    this.editandoId = limite.id;
    this.categoriaId = limite.categoria_id;
    this.valorLimite = limite.valor_limite;

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  cancelarEdicao() {
    this.editandoId = null;
    this.categoriaId = "";
    this.valorLimite = 0;
  }

  async adicionar(event: Event) {
    event.preventDefault();

    if (!this.categoriaId || this.valorLimite <= 0) {
      return;
    }

    if (this.editandoId) {
      await this.db.run(
        `UPDATE limites_gastos
         SET categoria_id = ?,
             mes = ?,
             ano = ?,
             valor_limite = ?
         WHERE id = ?
           AND usuario_id = ?`,
        [
          this.categoriaId,
          this.mes,
          this.ano,
          this.valorLimite,
          this.editandoId,
          USUARIO_LOCAL_ID,
        ]
      );
    } else {
      const existente = await this.db.query<Limite>(
        `SELECT id
         FROM limites_gastos
         WHERE usuario_id = ?
           AND categoria_id = ?
           AND mes = ?
           AND ano = ?`,
        [
          USUARIO_LOCAL_ID,
          this.categoriaId,
          this.mes,
          this.ano,
        ]
      );

      if (existente.length > 0) {
        return;
      }

      await this.db.run(
        `INSERT INTO limites_gastos
          (id, usuario_id, categoria_id, mes, ano, valor_limite)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          this.db.gerarId(),
          USUARIO_LOCAL_ID,
          this.categoriaId,
          this.mes,
          this.ano,
          this.valorLimite,
        ]
      );
    }

    this.cancelarEdicao();
    await this.carregarLimites();
  }

  async remover(id: string) {
    await this.db.run(
      `DELETE FROM limites_gastos
       WHERE id = ?
         AND usuario_id = ?`,
      [id, USUARIO_LOCAL_ID]
    );

    await this.carregarLimites();
  }

  async importarMesAnterior() {
    let mesAnterior = this.mes - 1;
    let anoAnterior = this.ano;

    if (mesAnterior < 1) {
      mesAnterior = 12;
      anoAnterior--;
    }

    const limitesAnteriores = await this.db.query<Limite>(
      `SELECT categoria_id, valor_limite
       FROM limites_gastos
       WHERE usuario_id = ?
         AND mes = ?
         AND ano = ?`,
      [
        USUARIO_LOCAL_ID,
        mesAnterior,
        anoAnterior,
      ]
    );

    if (limitesAnteriores.length === 0) {
      return;
    }

    const limitesAtuais = await this.db.query<Limite>(
      `SELECT categoria_id
       FROM limites_gastos
       WHERE usuario_id = ?
         AND mes = ?
         AND ano = ?`,
      [
        USUARIO_LOCAL_ID,
        this.mes,
        this.ano,
      ]
    );

    const categoriasExistentes = new Set(
      limitesAtuais.map((limite) => limite.categoria_id)
    );

    for (const limite of limitesAnteriores) {
      if (categoriasExistentes.has(limite.categoria_id)) {
        continue;
      }

      await this.db.run(
        `INSERT INTO limites_gastos
          (id, usuario_id, categoria_id, mes, ano, valor_limite)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          this.db.gerarId(),
          USUARIO_LOCAL_ID,
          limite.categoria_id,
          this.mes,
          this.ano,
          limite.valor_limite,
        ]
      );
    }

    await this.carregarLimites();
  }
}