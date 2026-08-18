import { Component, EventEmitter, Output } from "@angular/core";
import { CommonModule } from "@angular/common";

/**
 * Pop-up de confirmação de exclusão usado por Contas e Cartões — dá ao
 * usuário a escolha entre manter o histórico (soft delete) ou apagar tudo
 * (hard delete em cascata). Quem usa chama `abrir()` via referência de
 * template (#confirmarExclusao) e escuta (manterHistorico)/(apagarTudo).
 */
@Component({
    selector: "app-confirmar-exclusao",
    standalone: true,
    imports: [CommonModule],
    templateUrl: "./confirmar-exclusao.component.html",
    styleUrl: "./confirmar-exclusao.component.css",
})
export class ConfirmarExclusaoComponent {
    @Output() manterHistorico = new EventEmitter<void>();
    @Output() apagarTudo = new EventEmitter<void>();

    modalAberto = false;
    nomeItem = "";
    tipoItem: "conta" | "cartão" = "conta";

    abrir(nomeItem: string, tipoItem: "conta" | "cartão"): void {
        this.nomeItem = nomeItem;
        this.tipoItem = tipoItem;
        this.modalAberto = true;
    }

    cancelar(): void {
        this.modalAberto = false;
    }

    confirmarManterHistorico(): void {
        this.modalAberto = false;
        this.manterHistorico.emit();
    }

    confirmarApagarTudo(): void {
        this.modalAberto = false;
        this.apagarTudo.emit();
    }
}
