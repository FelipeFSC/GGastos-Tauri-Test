import {
    AfterViewInit,
    Component,
    ElementRef,
    EventEmitter,
    HostListener,
    Input,
    OnDestroy,
    Output,
    ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";

export interface CategoriaOpcao {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
    categoria_pai_id?: string | null;
}

export interface GrupoCategoria {
    principal: CategoriaOpcao;
    subcategorias: CategoriaOpcao[];
}

/**
 * Select customizado de categoria: a categoria principal mostra o ícone
 * dela (quadrado colorido), a subcategoria mostra só uma bolinha com a
 * cor da categoria-mãe — em vez do <option> nativo do navegador.
 *
 * Quem usa já entrega os grupos prontos (principal + subcategorias),
 * já filtrados por tipo/ativo — este componente só cuida de exibir e
 * escolher, não decide o que pode aparecer.
 */
@Component({
    selector: "app-categoria-select",
    standalone: true,
    imports: [CommonModule],
    templateUrl: "./categoria-select.component.html",
    styleUrl: "./categoria-select.component.css",
})
export class CategoriaSelectComponent implements AfterViewInit, OnDestroy {
    @Input() grupos: GrupoCategoria[] = [];
    @Input() categoriaId: string | null = null;
    @Input() placeholder = "Selecione uma categoria";

    @Output() categoriaIdChange = new EventEmitter<string>();

    @ViewChild("trigger") trigger!: ElementRef<HTMLButtonElement>;
    @ViewChild("painel") painel?: ElementRef<HTMLDivElement>;

    aberto = false;

    top = 0;
    left = 0;
    width = 0;

    private aoRolarDocumento = (evento: Event): void => {
        // Rolar dentro do próprio painel (a lista de categorias) não pode
        // fechar ele — só rolar o resto da página (ex.: o corpo da modal
        // por trás) é que precisa fechar, senão o painel ficaria
        // desalinhado do campo.
        const alvo = evento.target as Node;

        if (this.painel?.nativeElement.contains(alvo)) {
            return;
        }

        this.fechar();
    };

    ngAfterViewInit(): void {
        // Scroll não borbulha até o document, então precisa escutar na
        // fase de captura pra fechar o painel se o corpo da modal rolar.
        document.addEventListener("scroll", this.aoRolarDocumento, true);
    }

    ngOnDestroy(): void {
        document.removeEventListener("scroll", this.aoRolarDocumento, true);
    }

    get categoriaSelecionada(): CategoriaOpcao | null {
        for (const grupo of this.grupos) {
            if (grupo.principal.id === this.categoriaId) {
                return grupo.principal;
            }

            const subcategoria = grupo.subcategorias.find(
                (item) => item.id === this.categoriaId,
            );

            if (subcategoria) {
                return subcategoria;
            }
        }

        return null;
    }

    get ehSubcategoriaSelecionada(): boolean {
        return !!this.categoriaSelecionada?.categoria_pai_id;
    }

    alternar(): void {
        if (this.aberto) {
            this.fechar();
            return;
        }

        const retangulo = this.trigger.nativeElement.getBoundingClientRect();

        this.top = retangulo.bottom + 4;
        this.left = retangulo.left;
        this.width = retangulo.width;

        this.aberto = true;
    }

    fechar(): void {
        this.aberto = false;
    }

    selecionar(id: string): void {
        this.categoriaIdChange.emit(id);
        this.fechar();
    }

    @HostListener("document:click", ["$event"])
    aoClicarFora(evento: MouseEvent): void {
        if (!this.aberto) {
            return;
        }

        const alvo = evento.target as Node;

        const dentroDoGatilho = this.trigger.nativeElement.contains(alvo);
        const dentroDoPainel = this.painel?.nativeElement.contains(alvo);

        if (!dentroDoGatilho && !dentroDoPainel) {
            this.fechar();
        }
    }
}
