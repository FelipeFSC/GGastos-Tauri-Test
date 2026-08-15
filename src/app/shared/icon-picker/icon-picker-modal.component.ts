import {
    Component,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    SimpleChanges,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

/**
 * Cache em nível de módulo: o material-icons.json tem alguns MB, então
 * carregamos só uma vez, na primeira vez que algum modal for aberto,
 * e reaproveitamos entre todas as instâncias (categorias, contas, cartões...).
 */
let iconesCache: Promise<string[]> | null = null;

async function carregarIcones(): Promise<string[]> {
    if (!iconesCache) {
        iconesCache = fetch("assets/material-icons.json")
            .then((resposta) => {
                if (!resposta.ok) {
                    throw new Error(
                        `Erro ao carregar material-icons.json: ${resposta.status}`,
                    );
                }
                return resposta.json();
            })
            .then((dados: any[]) => {
                if (!Array.isArray(dados)) {
                    throw new Error("O arquivo material-icons.json não contém um array.");
                }

                const nomes = dados
                    .filter((icone) => {
                        const unsupported = Array.isArray(icone.unsupported_families)
                            ? icone.unsupported_families
                            : [];
                        return !unsupported.includes("Material Icons");
                    })
                    .map((icone) => icone.name)
                    .filter(
                        (nome): nome is string =>
                            typeof nome === "string" && nome.trim().length > 0,
                    );

                return [...new Set(nomes)].sort((a, b) => a.localeCompare(b));
            })
            .catch((erro) => {
                console.error("Erro ao carregar ícones:", erro);
                iconesCache = null; // permite tentar de novo numa próxima abertura
                return [];
            });
    }

    return iconesCache;
}

@Component({
    selector: "app-icon-picker-modal",
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: "./icon-picker-modal.component.html",
    styleUrl: "./icon-picker-modal.component.css",
})
export class IconPickerModalComponent implements OnChanges {
    @Input() aberto = false;
    @Output() fechar = new EventEmitter<void>();
    @Output() selecionar = new EventEmitter<string>();

    carregando = false;
    icones: string[] = [];
    iconesFiltrados: string[] = [];
    busca = "";

    async ngOnChanges(changes: SimpleChanges): Promise<void> {
        if (changes["aberto"] && this.aberto && this.icones.length === 0) {
            this.carregando = true;
            this.icones = await carregarIcones();
            this.iconesFiltrados = [...this.icones];
            this.carregando = false;
        }

        if (changes["aberto"] && this.aberto) {
            this.busca = "";
            this.iconesFiltrados = [...this.icones];
        }
    }

    filtrar(): void {
        const termo = this.busca.trim().toLowerCase();

        this.iconesFiltrados = !termo
            ? [...this.icones]
            : this.icones.filter((icone) => icone.toLowerCase().includes(termo));
    }

    limparBusca(): void {
        this.busca = "";
        this.filtrar();
    }

    /** Mostra no máximo 300 ícones de uma vez; a busca continua funcionando normalmente. */
    iconesVisiveis(): string[] {
        return this.iconesFiltrados.slice(0, 300);
    }

    escolher(icone: string): void {
        this.selecionar.emit(icone);
    }

    fecharModal(): void {
        this.fechar.emit();
    }
}
