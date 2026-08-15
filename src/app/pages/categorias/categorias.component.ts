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

@Component({
  selector: "app-categorias",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./categorias.component.html",
  styleUrl: "./categorias.component.css",
})
export class CategoriasComponent implements OnInit {
  categorias: Categoria[] = [];

  // Nova categoria
  nome = "";
  tipo = "despesa";
  icone = "";
  cor = "#4285f4";

  // Nova subcategoria
  categoriaSubAberta: string | null = null;
  nomeSubcategoria = "";

  // Edição da categoria principal
  categoriaEditando: string | null = null;
  nomeEdicao = "";
  tipoEdicao = "despesa";
  iconeEdicao = "";
  corEdicao = "#4285f4";

  // Edição da subcategoria
  subcategoriaEditando: string | null = null;
  nomeSubcategoriaEdicao = "";

  constructor(private db: DatabaseService) {}

  async ngOnInit() {
    await this.carregar();
  }

  async carregar() {
    this.categorias = await this.db.query<Categoria>(
      "SELECT * FROM categorias ORDER BY nome"
    );
  }

  categoriasPrincipais(): Categoria[] {
    return this.categorias.filter(
      (categoria) => !categoria.categoria_pai_id
    );
  }

  subcategorias(categoriaPaiId: string): Categoria[] {
    return this.categorias.filter(
      (categoria) => categoria.categoria_pai_id === categoriaPaiId
    );
  }

  // =========================================================
  // NOVA CATEGORIA
  // =========================================================

  async adicionar(event: Event) {
    event.preventDefault();

    if (!this.nome.trim()) return;

    await this.db.run(
      `INSERT INTO categorias
        (id, usuario_id, categoria_pai_id, tipo, nome, icone, cor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.db.gerarId(),
        USUARIO_LOCAL_ID,
        null,
        this.tipo,
        this.nome.trim(),
        this.icone || null,
        this.cor || null,
      ]
    );

    this.nome = "";
    this.icone = "";
    this.cor = "#4285f4";

    await this.carregar();
  }

  // =========================================================
  // EDIÇÃO DA CATEGORIA PRINCIPAL
  // =========================================================

  editarCategoria(categoria: Categoria) {
    this.categoriaEditando = categoria.id;

    this.nomeEdicao = categoria.nome;
    this.tipoEdicao = categoria.tipo;
    this.iconeEdicao = categoria.icone || "";
    this.corEdicao = categoria.cor || "#4285f4";

    // Fecha a criação de subcategoria caso esteja aberta
    this.categoriaSubAberta = null;
    this.nomeSubcategoria = "";
  }

  cancelarEdicao() {
    this.categoriaEditando = null;

    this.nomeEdicao = "";
    this.tipoEdicao = "despesa";
    this.iconeEdicao = "";
    this.corEdicao = "#4285f4";
  }

  async salvarEdicao(event: Event, categoria: Categoria) {
    event.preventDefault();

    const nome = this.nomeEdicao.trim();

    if (!nome) return;

    await this.db.run(
      `UPDATE categorias
       SET nome = ?, tipo = ?, icone = ?, cor = ?
       WHERE id = ?`,
      [
        nome,
        this.tipoEdicao,
        this.iconeEdicao || null,
        this.corEdicao || null,
        categoria.id,
      ]
    );

    this.cancelarEdicao();

    await this.carregar();
  }

  // =========================================================
  // NOVA SUBCATEGORIA
  // =========================================================

  abrirSubcategoria(categoriaId: string) {
    this.categoriaSubAberta = categoriaId;
    this.nomeSubcategoria = "";

    // Fecha edição de categoria
    this.categoriaEditando = null;
  }

  cancelarSubcategoria() {
    this.categoriaSubAberta = null;
    this.nomeSubcategoria = "";
  }

  async adicionarSubcategoria(
    event: Event,
    categoriaPai: Categoria
  ) {
    event.preventDefault();

    const nome = this.nomeSubcategoria.trim();

    if (!nome) return;

    await this.db.run(
      `INSERT INTO categorias
        (id, usuario_id, categoria_pai_id, tipo, nome, icone, cor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.db.gerarId(),
        USUARIO_LOCAL_ID,
        categoriaPai.id,
        categoriaPai.tipo,
        nome,
        null,
        categoriaPai.cor,
      ]
    );

    this.nomeSubcategoria = "";
    this.categoriaSubAberta = null;

    await this.carregar();
  }

  // =========================================================
  // EDIÇÃO DA SUBCATEGORIA
  // =========================================================

  editarSubcategoria(subcategoria: Categoria) {
    this.subcategoriaEditando = subcategoria.id;
    this.nomeSubcategoriaEdicao = subcategoria.nome;
  }

  cancelarEdicaoSubcategoria() {
    this.subcategoriaEditando = null;
    this.nomeSubcategoriaEdicao = "";
  }

  async salvarEdicaoSubcategoria(
    event: Event,
    subcategoria: Categoria
  ) {
    event.preventDefault();

    const nome = this.nomeSubcategoriaEdicao.trim();

    if (!nome) return;

    await this.db.run(
      `UPDATE categorias
       SET nome = ?
       WHERE id = ?`,
      [
        nome,
        subcategoria.id,
      ]
    );

    this.cancelarEdicaoSubcategoria();

    await this.carregar();
  }

  // =========================================================
  // REMOVER
  // =========================================================

  async remover(id: string) {
    await this.db.run(
      "DELETE FROM categorias WHERE id = ? OR categoria_pai_id = ?",
      [id, id]
    );

    await this.carregar();
  }
}