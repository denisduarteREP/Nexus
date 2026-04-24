import sqlite3
import os

# Altera o local do banco para uma pasta oculta no perfil do usuario, evitando poluir o Desktop
db_directory = os.path.join(os.path.expanduser("~"), ".nexus_hub")
os.makedirs(db_directory, exist_ok=True)
db_path = os.path.join(db_directory, "nexus_hub.db")

# Garante que a tabela de lojas exista antes de qualquer operacao.
def init_db():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lojas (
            id_loja TEXT PRIMARY KEY,
            nome_loja TEXT NOT NULL,
            ip_loja TEXT NOT NULL UNIQUE
        )
    """)
    conn.commit()
    conn.close()

# Insere uma loja individual, retornando False em caso de duplicidade.
def add_loja(id_loja, nome_loja, ip_loja):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO lojas (id_loja, nome_loja, ip_loja) VALUES (?, ?, ?)", (id_loja, nome_loja, ip_loja))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False # id_loja or ip_loja already exists
    finally:
        conn.close()

# Insere varias lojas em uma unica conexao para melhorar desempenho em importacoes grandes.
def add_lojas_batch(records):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    imported = 0
    rejected = []
    try:
        for record in records:
            id_loja = (record.get('id') or '').strip()
            nome_loja = (record.get('nome') or '').strip()
            ip_loja = (record.get('ip') or '').strip()

            if not id_loja or not nome_loja or not ip_loja:
                rejected.append({'values': record, 'reason': 'Registro incompleto'})
                continue

            try:
                cursor.execute(
                    "INSERT INTO lojas (id_loja, nome_loja, ip_loja) VALUES (?, ?, ?)",
                    (id_loja, nome_loja, ip_loja)
                )
                imported += 1
            except sqlite3.IntegrityError:
                rejected.append({'values': record, 'reason': 'Registro duplicado no banco'})

        conn.commit()
        return imported, rejected
    finally:
        conn.close()

# Busca lojas por ID, nome ou IP usando filtro parcial.
def get_loja(query):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    normalized_query = (query or '').strip()
    search_term = f'%{normalized_query}%'
    cursor.execute(
        """
        SELECT id_loja, nome_loja, ip_loja
        FROM lojas
        WHERE id_loja LIKE ?
           OR nome_loja LIKE ?
           OR ip_loja LIKE ?
        ORDER BY id_loja ASC
        """,
        (search_term, search_term, search_term)
    )
    results = cursor.fetchall()
    conn.close()
    return results

# Retorna todas as lojas atualmente cadastradas.
def get_all_lojas():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT id_loja, nome_loja, ip_loja FROM lojas")
    results = cursor.fetchall()
    conn.close()
    return results

# Initialize the database when the module is imported
init_db()


# Remove todos os registros da tabela de lojas.
def clear_lojas():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM lojas')
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted


# Atualiza uma loja existente tomando como referencia o ID original.
def update_loja(original_id, id_loja, nome_loja, ip_loja):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE lojas SET id_loja = ?, nome_loja = ?, ip_loja = ? WHERE id_loja = ?",
            (id_loja, nome_loja, ip_loja, original_id)
        )
        conn.commit()
        return cursor.rowcount > 0
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


# Exclui uma loja especifica pelo ID.
def delete_loja(id_loja):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM lojas WHERE id_loja = ?", (id_loja,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted > 0
