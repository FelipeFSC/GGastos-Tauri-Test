import { Component, EventEmitter, Output } from "@angular/core";
import { CommonModule } from "@angular/common";

export interface Banco {
    id: string;
    nome: string;
    cor: string;
    icone: string;
    disponivel: boolean;
}

/**
 * Lista de bancos suportados na importação de extrato. Só o Nubank
 * está com `disponivel: true` por enquanto — os outros aparecem já na
 * grade, com a identidade visual deles, mas desabilitados, prontos pra
 * ativar quando o parser daquele banco existir.
 */
export const BANCOS: Banco[] = [
    { id: "nubank", nome: "Nubank", cor: "#820ad1", icone: "account_balance", disponivel: true },
];

/**
 * Seletor "temático" de banco (cor + ícone da marca), usado como
 * primeiro passo tanto na importação de extrato de cartão quanto na de
 * conta bancária. Compartilhado entre as duas telas pra manter a mesma
 * cara e a mesma lista de bancos num só lugar.
 */
@Component({
    selector: "app-banco-seletor",
    standalone: true,
    imports: [CommonModule],
    templateUrl: "./banco-seletor.component.html",
    styleUrl: "./banco-seletor.component.css",
})
export class BancoSeletorComponent {
    bancos = BANCOS;

    @Output() selecionado = new EventEmitter<string>();

    escolher(banco: Banco): void {
        if (!banco.disponivel) {
            return;
        }

        this.selecionado.emit(banco.id);
    }
}
