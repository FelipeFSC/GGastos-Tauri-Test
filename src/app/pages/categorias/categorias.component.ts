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

    // =========================================================
    // ÍCONES
    // =========================================================

    icones: string[] = [];
    iconesFiltrados: string[] = [];

    iconeModalAberto = false;
    buscaIcone = "";

    // Indica qual campo está sendo preenchido
    campoIconeAtual: "novo" | "edicao" = "novo";

    // =========================================================
    // NOVA CATEGORIA
    // =========================================================

    nome = "";
    tipo = "despesa";
    icone = "";
    cor = "#4285f4";

    // =========================================================
    // NOVA SUBCATEGORIA
    // =========================================================

    categoriaSubAberta: string | null = null;
    nomeSubcategoria = "";

    // =========================================================
    // EDIÇÃO DA CATEGORIA PRINCIPAL
    // =========================================================

    categoriaEditando: string | null = null;

    nomeEdicao = "";
    tipoEdicao = "despesa";
    iconeEdicao = "";
    corEdicao = "#4285f4";

    // =========================================================
    // EDIÇÃO DA SUBCATEGORIA
    // =========================================================

    subcategoriaEditando: string | null = null;
    nomeSubcategoriaEdicao = "";

    constructor(private db: DatabaseService) { }

    // =========================================================
    // INIT
    // =========================================================

    async ngOnInit() {
        await this.carregar();
        await this.carregarIcones();
    }

    // =========================================================
    // CATEGORIAS
    // =========================================================

    async carregar() {
        this.categorias = await this.db.query<Categoria>(
            "SELECT * FROM categorias ORDER BY nome",
        );
    }

    categoriasPrincipais(): Categoria[] {
        return this.categorias.filter((categoria) => !categoria.categoria_pai_id);
    }

    subcategorias(categoriaPaiId: string): Categoria[] {
        return this.categorias.filter(
            (categoria) => categoria.categoria_pai_id === categoriaPaiId,
        );
    }

    // =========================================================
    // CARREGAR ÍCONES
    // =========================================================

    async carregarIcones() {
        try {
            const response = await fetch("assets/material-icons.json");

            if (!response.ok) {
                throw new Error(
                    `Erro ao carregar material-icons.json: ${response.status}`,
                );
            }

            const dados = await response.json();

            if (!Array.isArray(dados)) {
                throw new Error("O arquivo material-icons.json não contém um array.");
            }

            /*
             * O JSON possui várias entradas para o mesmo ícone.
             *
             * Exemplo:
             *
             * {
             *   "name": "10k",
             *   ...
             *   "unsupported_families": [
             *     "Material Icons",
             *     ...
             *   ]
             * }
             *
             * e outra entrada:
             *
             * {
             *   "name": "10k",
             *   ...
             *   "unsupported_families": [
             *     "Material Symbols Outlined",
             *     ...
             *   ]
             * }
             *
             * Como estamos usando:
             *
             * <span class="material-icons">
             *
             * queremos somente os ícones compatíveis com
             * Material Icons.
             */

            const nomes = dados
                .filter((icone: any) => {
                    const unsupported = Array.isArray(icone.unsupported_families)
                        ? icone.unsupported_families
                        : [];

                    // Se "Material Icons" NÃO está nos
                    // unsupported_families, significa que
                    // o ícone suporta Material Icons.
                    return !unsupported.includes("Material Icons");
                })
                .map((icone: any) => icone.name)
                .filter(
                    (nome: unknown): nome is string =>
                        typeof nome === "string" && nome.trim().length > 0,
                );

            /*
             * Remove nomes duplicados.
             */
            this.icones = [...new Set(nomes)].sort((a, b) => a.localeCompare(b));

            this.iconesFiltrados = [...this.icones];

            console.log(`Ícones Material Icons carregados: ${this.icones.length}`);
        } catch (error) {
            console.error("Erro ao carregar ícones:", error);

            this.icones = [];
            this.iconesFiltrados = [];
        }
    }
    // =========================================================
    // SELETOR DE ÍCONES
    // =========================================================

    abrirSeletorIcone(campo: "novo" | "edicao") {
        this.campoIconeAtual = campo;

        this.buscaIcone = "";

        this.iconesFiltrados = [...this.icones];

        this.iconeModalAberto = true;
    }

    fecharSeletorIcone() {
        this.iconeModalAberto = false;
        this.buscaIcone = "";
    }

    filtrarIcones() {
        const busca = this.buscaIcone.trim().toLowerCase();

        if (!busca) {
            this.iconesFiltrados = [...this.icones];
            return;
        }

        this.iconesFiltrados = this.icones.filter((icone) =>
            icone.toLowerCase().includes(busca),
        );
    }

    selecionarIcone(icone: string) {
        if (this.campoIconeAtual === "novo") {
            this.icone = icone;
        } else {
            this.iconeEdicao = icone;
        }

        this.fecharSeletorIcone();
    }

    /**
     * Mostra no máximo 300 ícones de uma vez.
     * A busca continua funcionando normalmente.
     */
    iconesVisiveis(): string[] {
        return this.iconesFiltrados.slice(0, 300);
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
            ],
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

        // Fecha a criação de subcategoria
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
            ],
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

    async adicionarSubcategoria(event: Event, categoriaPai: Categoria) {
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
            ],
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

    async salvarEdicaoSubcategoria(event: Event, subcategoria: Categoria) {
        event.preventDefault();

        const nome = this.nomeSubcategoriaEdicao.trim();

        if (!nome) return;

        await this.db.run(
            `UPDATE categorias
       SET nome = ?
       WHERE id = ?`,
            [nome, subcategoria.id],
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
            [id, id],
        );

        await this.carregar();
    }
}
