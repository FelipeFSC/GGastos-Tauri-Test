import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
    DatabaseService,
    USUARIO_LOCAL_ID,
} from "../../services/database.service";
import { IconPickerButtonComponent } from "../../shared/icon-picker/icon-picker-button.component";

interface Categoria {
    id: string;
    nome: string;
    tipo: string;
    icone: string | null;
    cor: string | null;
    categoria_pai_id: string | null;
    ativo: number;
}

interface CategoriaPadrao {
    nome: string;
    icone: string;
    cor: string;
}

interface CategoriasPadraoArquivo {
    despesa: CategoriaPadrao[];
    receita: CategoriaPadrao[];
}

@Component({
    selector: "app-categorias",
    standalone: true,
    imports: [CommonModule, FormsModule, IconPickerButtonComponent],
    templateUrl: "./categorias.component.html",
    styleUrl: "./categorias.component.css",
})
export class CategoriasComponent implements OnInit {
    categorias: Categoria[] = [];

    filtroTipo: "todas" | "despesa" | "receita" = "todas";
    filtroStatus: "ativas" | "inativas" = "ativas";

    /** true enquanto as categorias padrão estão sendo cadastradas (spinner no botão). */
    carregandoPadrao = false;

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
    }

    // =========================================================
    // CATEGORIAS
    // =========================================================

    async carregar() {
        this.categorias = await this.db.query<Categoria>(
            "SELECT * FROM categorias ORDER BY nome",
        );
    }

    /** Atende o filtro Ativas/Inativas selecionado (independe do filtro de tipo). */
    private categoriaAtendeStatus(categoria: Categoria): boolean {
        return this.filtroStatus === "ativas" ? !!categoria.ativo : !categoria.ativo;
    }

    /**
     * Uma categoria principal aparece se ela mesma atende o filtro de
     * status, OU se alguma subcategoria dela atende — senão, filtrar por
     * "Inativas" esconderia uma subcategoria inativa presa debaixo de uma
     * categoria principal ainda ativa.
     */
    categoriasPrincipais(): Categoria[] {
        return this.categorias.filter((categoria) => {
            if (categoria.categoria_pai_id) {
                return false;
            }

            if (this.filtroTipo !== "todas" && categoria.tipo !== this.filtroTipo) {
                return false;
            }

            const subcategoriasDela = this.categorias.filter(
                (sub) => sub.categoria_pai_id === categoria.id,
            );

            return (
                this.categoriaAtendeStatus(categoria) ||
                subcategoriasDela.some((sub) => this.categoriaAtendeStatus(sub))
            );
        });
    }

    definirFiltroTipo(tipo: "todas" | "despesa" | "receita") {
        this.filtroTipo = tipo;
    }

    definirFiltroStatus(status: "ativas" | "inativas") {
        this.filtroStatus = status;
    }

    subcategorias(categoriaPaiId: string): Categoria[] {
        return this.categorias.filter(
            (categoria) =>
                categoria.categoria_pai_id === categoriaPaiId &&
                this.categoriaAtendeStatus(categoria),
        );
    }

    // =========================================================
    // CATEGORIAS PADRÃO (suporte a usuário de primeira viagem)
    // =========================================================

    /**
     * Cadastra de uma vez uma leva de categorias já prontas (despesa e
     * receita), lidas de assets/categorias-padrao.json — só aparece
     * quando o usuário ainda não tem nenhuma categoria cadastrada.
     */
    async adicionarCategoriasPadrao() {
        if (this.carregandoPadrao) {
            return;
        }

        this.carregandoPadrao = true;

        try {
            const resposta = await fetch("assets/categorias-padrao.json");

            if (!resposta.ok) {
                throw new Error(
                    `Erro ao carregar categorias-padrao.json: ${resposta.status}`,
                );
            }

            const padrao: CategoriasPadraoArquivo = await resposta.json();

            const todas = [
                ...padrao.despesa.map((c) => ({ ...c, tipo: "despesa" })),
                ...padrao.receita.map((c) => ({ ...c, tipo: "receita" })),
            ];

            await this.db.run("BEGIN TRANSACTION");

            try {
                for (const categoria of todas) {
                    await this.db.run(
                        `INSERT INTO categorias
                (id, usuario_id, categoria_pai_id, tipo, nome, icone, cor)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            this.db.gerarId(),
                            USUARIO_LOCAL_ID,
                            null,
                            categoria.tipo,
                            categoria.nome,
                            categoria.icone,
                            categoria.cor,
                        ],
                    );
                }

                await this.db.run("COMMIT");
            } catch (erro) {
                await this.db.run("ROLLBACK");
                throw erro;
            }

            await this.carregar();
        } catch (erro) {
            console.error("Erro ao adicionar categorias padrão:", erro);
            alert("Não foi possível carregar as categorias padrão.");
        } finally {
            this.carregandoPadrao = false;
        }
    }

    // =========================================================
    // NOVA CATEGORIA
    // =========================================================

    async adicionar(event: Event) {
        event.preventDefault();

        const erro = this.validar(this.nome, this.tipo, this.icone, this.cor);

        if (erro) {
            alert(erro);
            return;
        }

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

    /** Nome, tipo, ícone e cor são obrigatórios (categoria principal). */
    private validar(
        nome: string,
        tipo: string,
        icone: string,
        cor: string,
    ): string | null {
        if (!nome.trim()) {
            return "Informe o nome da categoria.";
        }

        if (!tipo) {
            return "Selecione o tipo da categoria.";
        }

        if (!icone) {
            return "Selecione um ícone para a categoria.";
        }

        if (!cor) {
            return "Selecione uma cor para a categoria.";
        }

        return null;
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

        const erro = this.validar(
            this.nomeEdicao,
            this.tipoEdicao,
            this.iconeEdicao,
            this.corEdicao,
        );

        if (erro) {
            alert(erro);
            return;
        }

        const nome = this.nomeEdicao.trim();

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
                categoriaPai.icone,
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
        if (
            !confirm(
                "Tem certeza que deseja excluir esta categoria? Os lançamentos já registrados continuam existindo.",
            )
        ) {
            return;
        }

        await this.db.run(
            "UPDATE categorias SET ativo = 0 WHERE id = ? OR categoria_pai_id = ?",
            [id, id],
        );

        await this.carregar();
    }

    async reativar(id: string) {
        await this.db.run(
            "UPDATE categorias SET ativo = 1 WHERE id = ?",
            [id],
        );

        await this.carregar();
    }
}
