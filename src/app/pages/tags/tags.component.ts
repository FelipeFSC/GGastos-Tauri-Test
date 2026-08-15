import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DatabaseService,
  USUARIO_LOCAL_ID,
} from "../../services/database.service";

interface Tag {
  id: string;
  nome: string;
}

@Component({
  selector: "app-tags",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./tags.component.html",
  styleUrl: "./tags.component.css",
})
export class TagsComponent implements OnInit {
  tags: Tag[] = [];
  nome = "";

  constructor(private db: DatabaseService) {}

  async ngOnInit() {
    await this.carregar();
  }

  async carregar() {
    this.tags = await this.db.query<Tag>(
      "SELECT * FROM tags ORDER BY nome"
    );
  }

  async adicionar(event: Event) {
    event.preventDefault();

    const nome = this.nome.trim();

    if (!nome) return;

    await this.db.run(
      `INSERT INTO tags (id, usuario_id, nome)
       VALUES (?, ?, ?)`,
      [
        this.db.gerarId(),
        USUARIO_LOCAL_ID,
        nome,
      ]
    );

    this.nome = "";

    await this.carregar();
  }

  async remover(id: string) {
    await this.db.run(
      "DELETE FROM tags WHERE id = ?",
      [id]
    );

    await this.carregar();
  }
}