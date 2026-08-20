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

export interface OrigemOpcao {
    id: string;
    nome: string;
    icone?: string | null;
    cor?: string | null;
}

export interface GrupoOrigem {
    rotulo: string;
    prefixo: "conta" | "cartao";
    iconePadrao: string;
    itens: OrigemOpcao[];
}

/**
 * Select customizado de conta/cartão: cada item mostra o próprio ícone
 * num quadrado colorido, agrupado em "Contas" e "Cartões" — em vez do
 * <select>/<optgroup> nativo. Mesmo mecanismo de posicionamento/
 * fechamento do app-categoria-select (ver aquele componente pros
 * comentários completos sobre o porquê de cada parte).
 */
@Component({
    selector: "app-origem-select",
    standalone: true,
    imports: [CommonModule],
    templateUrl: "./origem-select.component.html",
    styleUrl: "./origem-select.component.css",
})
export class OrigemSelectComponent implements AfterViewInit, OnDestroy {
    @Input() grupos: GrupoOrigem[] = [];
    @Input() origem = "";
    @Input() placeholder = "Selecione uma conta ou cartão";
    @Input() disabled = false;

    @Output() origemChange = new EventEmitter<string>();

    @ViewChild("trigger") trigger!: ElementRef<HTMLButtonElement>;
    @ViewChild("painel") painel?: ElementRef<HTMLDivElement>;

    aberto = false;

    top = 0;
    left = 0;
    width = 0;

    private aoRolarDocumento = (evento: Event): void => {
        const alvo = evento.target as Node;

        if (this.painel?.nativeElement.contains(alvo)) {
            return;
        }

        this.fechar();
    };

    ngAfterViewInit(): void {
        document.addEventListener("scroll", this.aoRolarDocumento, true);
    }

    ngOnDestroy(): void {
        document.removeEventListener("scroll", this.aoRolarDocumento, true);
    }

    get temItens(): boolean {
        return this.grupos.some((grupo) => grupo.itens.length > 0);
    }

    get itemSelecionado(): { item: OrigemOpcao; grupo: GrupoOrigem } | null {
        for (const grupo of this.grupos) {
            const item = grupo.itens.find(
                (item) => `${grupo.prefixo}:${item.id}` === this.origem,
            );

            if (item) {
                return { item, grupo };
            }
        }

        return null;
    }

    alternar(): void {
        if (this.disabled) {
            return;
        }

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

    selecionar(grupo: GrupoOrigem, item: OrigemOpcao): void {
        this.origemChange.emit(`${grupo.prefixo}:${item.id}`);
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
