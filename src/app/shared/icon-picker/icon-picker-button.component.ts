import { Component, EventEmitter, Input, Output } from "@angular/core";
import { CommonModule } from "@angular/common";
import { IconPickerModalComponent } from "./icon-picker-modal.component";

/**
 * Botão + pop-up de seleção de ícone (Material Icons), reutilizado nas
 * telas de Categorias, Contas e Cartões. Só cuida do ícone — a cor
 * continua sendo um <input type="color"> normal em cada tela.
 *
 * Uso:
 *   <app-icon-picker-button
 *     [icone]="icone"
 *     [cor]="cor"
 *     (iconeSelecionado)="icone = $event"
 *   ></app-icon-picker-button>
 */
@Component({
	selector: "app-icon-picker-button",
	standalone: true,
	imports: [CommonModule, IconPickerModalComponent],
	templateUrl: "./icon-picker-button.component.html",
	styleUrl: "./icon-picker-button.component.css",
})
export class IconPickerButtonComponent {
	@Input() icone: string | null = null;
	@Input() cor: string | null = null;

	@Output() iconeSelecionado = new EventEmitter<string>();

	modalAberto = false;

	abrir(): void {
		this.modalAberto = true;
	}

	fechar(): void {
		this.modalAberto = false;
	}

	selecionar(icone: string): void {
		this.iconeSelecionado.emit(icone);
		this.modalAberto = false;
	}
}
