import eel
import sys
import os
import threading
import subprocess
import paramiko
import xml.etree.ElementTree as ET
import socket
import json
import csv
import io
import shutil
import logging
import ipaddress
import getpass
import platform
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from tkinter import Tk, filedialog
from datetime import datetime
from modules.database import add_loja, add_lojas_batch, get_loja, get_all_lojas, clear_lojas, update_loja, delete_loja

# Configuracoes do Eel
if getattr(sys, 'frozen', False):
    # Se rodando como executável (PyInstaller)
    BASE_DIR = sys._MEIPASS
else:
    # Se rodando como script Python normal
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, 'web')
eel.init(WEB_DIR)

# Configure logging para ajudar no debug
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# Silenciar logs excessivos do paramiko no console
logging.getLogger("paramiko").setLevel(logging.WARNING)

# Configuracoes SSH
DEFAULT_USER = "administrador"
DEFAULT_PASS = os.getenv("NEXUS_SSH_PASS", "jhASTYI%#$") # Busca de variavel de ambiente ou fallback
DEFINE_PORT = 22
REQUIRED_CSV_HEADERS = ['id', 'nome', 'ip']
LAST_CSV_PREVIEW = []
LAST_CSV_FILENAME = None
CSV_PREVIEW_LIMIT = 100

# Caminho de dados e logs
log_directory = os.path.join(os.path.expanduser("~"), ".nexus_hub", "logs")
os.makedirs(log_directory, exist_ok=True)
data_file_path = os.path.join(log_directory, "nexus_transfer_data.json")
log_file_path = os.path.join(log_directory, "nexus_transfer_log.txt")

# --- CONFIGURAÇÃO DE TELEMETRIA ---
CURRENT_VERSION = "V17.1"
# DICA: Crie um Webhook no Discord ou Teams e cole a URL abaixo para receber notificações
TELEMETRY_WEBHOOK_URL = "https://discord.com/api/webhooks/1497329118818074648/72DQP5VRXY4yt3VMmSoGyWhs4PXj-zXsmF1rWzP7xiWOXzAVcZfv3wXOxSUv73o9mFfB"

# --- CONFIGURAÇÃO DE ATUALIZAÇÃO ---
# URL de um JSON contendo {"version": "V17.2", "url": "http://servidor/NEXUS_HUB.exe"}
UPDATE_CHECK_URL = "https://raw.githubusercontent.com/denisduarteREP/Nexus/main/nexus_update.json" 

def send_telemetry_startup():
    """Envia um sinal de vida para um Webhook centralizado quando o app inicia."""
    if not TELEMETRY_WEBHOOK_URL:
        return

    user = getpass.getuser()
    node = platform.node()
    os_info = platform.system() + " " + platform.release()
    
    payload = {
        "embeds": [{
            "title": "🚀 NEXUS HUB INICIADO",
            "color": 2329214, # Cor Azul (NEXUS)
            "fields": [
                {"name": "👤 Usuário", "value": f"`{user}`", "inline": True},
                {"name": "💻 Máquina", "value": f"`{node}`", "inline": True},
                {"name": "🖥️ SO", "value": f"`{os_info}`", "inline": False},
                {"name": "🏷️ Versão", "value": f"`{CURRENT_VERSION}`", "inline": True},
                {"name": "📅 Data/Hora", "value": datetime.now().strftime('%d/%m/%Y %H:%M:%S'), "inline": True}
            ],
            "footer": {"text": "Telemetria Automática Nexus"}
        }]
    }
    
    try:
        req = urllib.request.Request(TELEMETRY_WEBHOOK_URL, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'Nexus-Telemetry'})
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        logging.warning(f"Falha ao enviar telemetria: {e}")

@eel.expose
def check_for_updates():
    """Verifica se existe uma nova versão disponível."""
    if not getattr(sys, 'frozen', False):
        return {"status": "debug", "message": "Update desativado em modo script."}

    try:
        with urllib.request.urlopen(UPDATE_CHECK_URL, timeout=5) as response:
            data = json.loads(response.read().decode())
            remote_version = data.get("version")
            download_url = data.get("url")

            if remote_version and remote_version > CURRENT_VERSION:
                return {"status": "update_available", "version": remote_version, "url": download_url}
    except Exception as e:
        logging.error(f"Erro ao verificar update: {e}")
    
    return {"status": "up_to_date"}

@eel.expose
def start_update_process(download_url):
    """Baixa a nova versão e agenda a substituição do executável."""
    try:
        exe_path = sys.executable
        temp_exe = exe_path + ".new"
        
        eel.js_log("Baixando nova versão...", "info")()
        
        # Baixa o novo executável
        urllib.request.urlretrieve(download_url, temp_exe)
        
        # Cria o script de atualização (.bat)
        # O script espera 2s, deleta o antigo, renomeia o novo e inicia.
        bat_path = os.path.join(os.path.dirname(exe_path), "nexus_updater.bat")
        with open(bat_path, "w") as f:
            f.write(f'@echo off\n')
            f.write(f'timeout /t 3 /nobreak > nul\n')
            f.write(f'del "{exe_path}"\n')
            f.write(f'move "{temp_exe}" "{exe_path}"\n')
            f.write(f'start "" "{exe_path}"\n')
            f.write(f'(goto) 2>nul & del "%~f0"\n') # Deleta o próprio .bat de forma mais segura

        eel.js_log("Aplicação será reiniciada para aplicar atualização.", "warning")()
        
        # Executa o .bat e fecha o NEXUS
        subprocess.Popen([bat_path], shell=True)
        os._exit(0)
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

def initialize_data_files():
    """Garante a existência das pastas e arquivos de dados iniciais."""
    # Garante que a pasta seed_data exista no ambiente de desenvolvimento
    # para evitar falhas no PyInstaller/Eel durante o empacotamento.
    if not getattr(sys, 'frozen', False):
        os.makedirs(os.path.join(BASE_DIR, "seed_data"), exist_ok=True)

    # Nota: Certifique-se que seu módulo de banco de dados também use o log_directory 
    # para localizar o arquivo .db
    
    # Caminho dos arquivos "Modelo" dentro da pasta do executável
    seed_folder = os.path.join(BASE_DIR, "seed_data")
    
    if not os.path.exists(log_directory):
        os.makedirs(log_directory, exist_ok=True)

    # Se o arquivo de grupos/agendamentos não existir, copia o modelo
    if not os.path.exists(data_file_path):
        source_json = os.path.join(seed_folder, "nexus_transfer_data.json")
        if os.path.exists(source_json):
            shutil.copy(source_json, data_file_path)

    # Se você tiver um arquivo .db para as lojas, adicione a cópia dele aqui também:
    db_path = os.path.join(log_directory, "nexus_hub.db") # Ajuste para o nome real do seu DB
    if not os.path.exists(db_path):
        source_db = os.path.join(seed_folder, "nexus_hub.db")
        if os.path.exists(source_db):
            shutil.copy(source_db, db_path)

# Carrega do disco a estrutura persistida de grupos e agendamentos.
def load_data():
    initialize_data_files()
    if os.path.exists(data_file_path):
        try:
            with open(data_file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {"groups": {}, "schedules": []}
    return {"groups": {}, "schedules": []}

# Salva no disco a estrutura atual de grupos e agendamentos.
def save_data(data):
    with open(data_file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

# Registra mensagens de apoio em arquivo texto para auditoria local.
def write_log_file(message):
    try:
        with open(log_file_path, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
    except:
        pass

# Detecta automaticamente o separador mais provavel do CSV.
def detect_csv_delimiter(content):
    sample = content[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
        return dialect.delimiter
    except csv.Error:
        return ';' if content.count(';') > content.count(',') else ','

# Normaliza cabecalhos vindos de planilhas diferentes para os nomes esperados.
def normalize_header(value):
    header = (value or '').replace('﻿', '').strip().lower()
    aliases = {
        'id_loja': 'id',
        'codigo': 'id',
        'código': 'id',
        'codigo_loja': 'id',
        'código_loja': 'id',
        'loja_id': 'id',
        'nome_loja': 'nome',
        'store_name': 'nome',
        'ip_loja': 'ip',
        'endereco_ip': 'ip',
        'endereço_ip': 'ip',
        'host': 'ip'
    }
    return aliases.get(header, header)

# Tenta abrir o arquivo CSV usando codificacoes comuns do Excel e do Windows.
def read_csv_file_content(file_path):
    encodings = ['utf-8-sig', 'utf-8', 'cp1252', 'latin-1']
    for encoding in encodings:
        try:
            with open(file_path, 'r', encoding=encoding) as file_handle:
                return file_handle.read()
        except UnicodeDecodeError:
            continue
    raise ValueError('Nao foi possivel ler o CSV com uma codificacao suportada.')


# Abre o seletor nativo do Windows para o usuario escolher um arquivo CSV.
def open_csv_dialog():
    root = Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    file_path = filedialog.askopenfilename(
        title='Selecione o arquivo de dados (CSV ou TXT)',
        filetypes=[('Arquivos de Texto/CSV', '*.csv;*.txt'), ('Todos os arquivos', '*.*')]
    )
    root.destroy()
    return file_path

@eel.expose
def select_local_path(selection_type='file'):
    """Abre um seletor nativo para o usuário escolher um arquivo ou pasta."""
    root = Tk()
    root.withdraw()
    root.attributes('-topmost', True) # Garante que a janela apareça na frente de tudo
    if selection_type == 'folder':
        path = filedialog.askdirectory(title='Selecione a pasta para transferir')
    else:
        path = filedialog.askopenfilename(title='Selecione o arquivo para transferir')
    root.destroy()
    return path


# Valida e transforma o conteudo bruto do CSV em registros prontos para analise.
def parse_lojas_csv(csv_data):
    content = (csv_data or '').replace('﻿', '').strip()
    if not content:
        return {'status': 'error', 'message': 'Arquivo CSV vazio.'}

    delimiter = detect_csv_delimiter(content)
    reader = csv.reader(io.StringIO(content), delimiter=delimiter)
    rows = [row for row in reader if any((col or '').strip() for col in row)]

    if not rows:
        return {'status': 'error', 'message': 'Nenhuma linha encontrada no CSV.'}

    normalized_headers = [normalize_header(col) for col in rows[0]]
    missing_headers = [header for header in REQUIRED_CSV_HEADERS if header not in normalized_headers]
    if missing_headers:
        return {
            'status': 'error',
            'message': 'O CSV precisa conter as colunas ID, Nome e IP.',
            'headers': rows[0]
        }
    header_index = {header: normalized_headers.index(header) for header in REQUIRED_CSV_HEADERS}

    records = []
    errors = []
    seen_ids = set()
    seen_ips = set()

    for line_number, row in enumerate(rows[1:], start=2):
        cleaned = [col.strip() for col in row]
        id_loja = cleaned[header_index['id']] if len(cleaned) > header_index['id'] else ''
        nome_loja = cleaned[header_index['nome']] if len(cleaned) > header_index['nome'] else ''
        ip_loja = cleaned[header_index['ip']] if len(cleaned) > header_index['ip'] else ''
        row_errors = []

        if not id_loja:
            row_errors.append('ID vazio')
        elif len(id_loja) > 20:
            row_errors.append('ID muito longo')

        if not nome_loja:
            row_errors.append('Nome vazio')
        elif len(nome_loja) < 3:
            row_errors.append('Nome muito curto')

        if not ip_loja:
            row_errors.append('IP vazio')
        else:
            try:
                ipaddress.ip_address(ip_loja)
            except ValueError:
                row_errors.append('IP invalido')

        key_id = id_loja.lower()
        key_ip = ip_loja.lower()
        if id_loja and key_id in seen_ids:
            row_errors.append('ID duplicado no arquivo')
        if ip_loja and key_ip in seen_ips:
            row_errors.append('IP duplicado no arquivo')

        if row_errors:
            errors.append({
                'line': line_number,
                'values': {'id': id_loja, 'nome': nome_loja, 'ip': ip_loja},
                'reason': '; '.join(row_errors)
            })
            continue

        seen_ids.add(key_id)
        seen_ips.add(key_ip)
        records.append({
            'line': line_number,
            'id': id_loja,
            'nome': nome_loja,
            'ip': ip_loja
        })

    return {
        'status': 'ok',
        'delimiter': delimiter,
        'records': records,
        'errors': errors,
        'total_rows': max(len(rows) - 1, 0)
    }

@eel.expose
# Retorna todos os hosts cadastrados nos grupos para a tela de monitoramento.
def get_all_hosts():
    data = load_data()
    all_hosts = set()
    for hosts in data.get("groups", {}).values():
        for h in hosts:
            all_hosts.add(h)
    return [{"name": h} for h in sorted(list(all_hosts))]

@eel.expose
# Entrega ao frontend todos os grupos atualmente salvos.
def get_groups():
    data = load_data()
    return data.get("groups", {})

@eel.expose
# Executa um ping em background e devolve o status para o frontend sem travar a UI.
def check_ping(hostname):
    def ping_thread():
        is_online = False
        try:
            # Tentativa 1: Verificação rápida via porta SSH (mais confiável em .exe)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2.0)
            result = sock.connect_ex((hostname, DEFINE_PORT))
            if result == 0:
                is_online = True
            sock.close()
        except:
            pass

        if not is_online:
            try:
                # Tentativa 2: Fallback para Ping tradicional se a porta estiver fechada
                param = '-n' if os.name == 'nt' else '-c'
                # startupinfo evita que janelas de console pisquem no Windows
                startupinfo = None
                if os.name == 'nt':
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                
                # Aumentado timeout para 3 segundos para maior estabilidade no executável
                subprocess.check_output(['ping', param, '1', hostname], 
                                       timeout=3, 
                                       stderr=subprocess.STDOUT, 
                                       startupinfo=startupinfo)
                is_online = True
            except:
                is_online = False
        
        eel.updateHostStatus(hostname, is_online)()
    threading.Thread(target=ping_thread, daemon=True).start()

@eel.expose
# Cria ou atualiza um grupo com a lista de hosts informada no formulario.
def save_group(name, hosts_str):
    data = load_data()
    hosts = [h.strip() for h in hosts_str.split(',') if h.strip()]
    if "groups" not in data:
        data["groups"] = {}
    data["groups"][name] = hosts
    save_data(data)
    return True

@eel.expose
def import_groups_csv_action():
    """Importa hosts de um arquivo TXT/CSV, usando o nome do arquivo como o nome do grupo."""
    file_path = open_csv_dialog()
    if not file_path:
        return {'status': 'cancelled'}

    try:
        # Extrai o nome do arquivo sem a extensão para usar como nome do grupo
        group_name = os.path.splitext(os.path.basename(file_path))[0]
        
        content = read_csv_file_content(file_path)
        lines = content.splitlines()
        
        data = load_data()
        if "groups" not in data:
            data["groups"] = {}

        # Inicializa o grupo se ele não existir
        if group_name not in data["groups"]:
            data["groups"][group_name] = []

        imported_count = 0
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            parts = []
            for sep in [',', ';', '\t']:
                if sep in line:
                    parts = [p.strip() for p in line.split(sep) if p.strip()]
                    if parts: break
            
            host = parts[-1] if parts else line
            
            if host.lower() in ['host', 'ip', 'hostname']:
                continue
            
            if host not in data["groups"][group_name]:
                data["groups"][group_name].append(host)
                imported_count += 1

        save_data(data)
        return {'status': 'ok', 'message': f'Sucesso! {imported_count} hosts importados no grupo "{group_name}".', 'count': imported_count}
    except Exception as e:
        logging.error(f"Erro na importação de grupos: {str(e)}")
        return {'status': 'error', 'message': str(e)}

@eel.expose
# Remove um grupo especifico do armazenamento local.
def delete_group(name):
    data = load_data()
    groups = data.get("groups", {})
    if name not in groups:
        return {"status": "error", "message": "Grupo nao encontrado."}

    del groups[name]
    data["groups"] = groups
    save_data(data)
    return {"status": "ok", "message": f"Grupo {name} removido com sucesso."}

@eel.expose
# Resolve o alvo informado e dispara as operacoes remotas de inventario, transferencia ou desligamento.
def run_task(task_type, target_input, local_dir=None, remote_dir=None):
    data = load_data()
    normalized_target = (target_input or '').strip()
    if not normalized_target:
        return {"status": "error", "message": "Nenhum alvo informado."}

    parts = [p.strip() for p in normalized_target.split(',') if p.strip()]
    resolved_hosts = []
    groups = data.get("groups", {})

    for item in parts:
        item_lower = item.lower()
        
        # 1. Tenta resolver como nome de Grupo (case-insensitive)
        matched_group_key = next((g for g in groups if g.lower() == item_lower), None)
        
        if matched_group_key:
            resolved_hosts.extend(groups[matched_group_key])
        else:
            # 2. Tenta resolver buscando no banco de dados de Lojas (ID ou Nome)
            db_matches = get_loja(item)
            if db_matches:
                # get_loja retorna lista de tuplas (id, nome, ip)
                resolved_hosts.extend([loja[2] for loja in db_matches])
            else:
                # 3. Fallback para IP/Hostname manual
                resolved_hosts.append(item)

    # Remove duplicatas mantendo a ordem original
    hosts = list(dict.fromkeys(resolved_hosts))

    if not hosts:
        return {"status": "error", "message": f"Nenhum host encontrado para '{normalized_target}'."}

    if task_type == "inventory":
        return_message = f"Inventario iniciado para {len(hosts)} host(s) (Alvo: {normalized_target})."
    elif task_type == "restart_mwpos":
        return_message = f"Reinicialização do MWPOS iniciada para {len(hosts)} host(s)."
    else:
        return_message = f"Operacao de {task_type} iniciada para {len(hosts)} host(s)."

    def task_thread():
        # Usamos ThreadPoolExecutor para processar ate 10 hosts simultaneamente
        with ThreadPoolExecutor(max_workers=10) as executor:
            for host in hosts:
                executor.submit(process_single_host, host, task_type, local_dir, remote_dir)
        
        eel.js_alert(f"Operacao de {task_type} finalizada!")()

    def process_single_host(host, task_type, local_dir, remote_dir):
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            eel.js_log(f"Conectando a {host}...", "info")()
            
            # Melhorado: Adicionado suporte a algoritmos legados que o Paramiko as vezes bloqueia
            client.connect(
                host, 
                port=DEFINE_PORT, 
                username=DEFAULT_USER, 
                password=DEFAULT_PASS, 
                timeout=15, 
                banner_timeout=30,
                disabled_algorithms=None
            )

            if task_type == "shutdown":
                stdin, stdout, stderr = client.exec_command("sudo -S sh -c 'shutdown -h now'", get_pty=True)
                stdin.write(DEFAULT_PASS + '\n')
                stdin.flush()
                try:
                    # Consome a saída para garantir que o comando seja processado
                    stdout.read()
                except:
                    pass # É esperado que a conexão caia no shutdown
                eel.js_log(f"SUCCESS: Shutdown enviado para {host}", "success")()

            elif task_type == "reboot":
                stdin, stdout, stderr = client.exec_command("sudo -S sh -c 'reboot'", get_pty=True)
                stdin.write(DEFAULT_PASS + '\n')
                stdin.flush()
                try:
                    # Consome a saída para garantir que o comando seja processado
                    stdout.read()
                except:
                    pass # É esperado que a conexão caia no reboot
                eel.js_log(f"SUCCESS: Reboot enviado para {host}", "success")()

            elif task_type == "restart_mwpos":
                eel.js_log(f"Reiniciando serviço em {host}...", "info")()
                # O uso de sh -c simula a execução dentro de um shell root, como o 'sudo su'
                stdin, stdout, stderr = client.exec_command("sudo -S sh -c 'systemctl restart mwpos_server.service --no-ask-password'", get_pty=True)
                stdin.write(DEFAULT_PASS + '\n')
                stdin.flush()
                
                # Captura a saída completa e aguarda o término da execução
                full_output = stdout.read().decode('utf-8', errors='ignore')
                exit_status = stdout.channel.recv_exit_status()

                if exit_status == 0:
                    eel.js_log(f"SUCCESS: MWPOS reiniciado em {host}", "success")()
                else:
                    # Limpa a mensagem para não mostrar a senha no log e exibir o erro real
                    clean_err = full_output.replace(DEFAULT_PASS, "******").strip()
                    eel.js_log(f"ERROR: {host} (Status {exit_status}): {clean_err}", "error")()

            elif task_type == "inventory":
                stdin, stdout, stderr = client.exec_command('sudo -S dmidecode -s system-product-name', get_pty=True)
                stdin.write(DEFAULT_PASS + '\n')
                stdin.flush()
                output = stdout.readlines()
                model = "Desconhecido"
                for line in output:
                    item = line.strip()
                    if item and DEFAULT_PASS not in item and "password" not in item.lower() and "sudo" not in item.lower():
                        model = item
                        break
                eel.updateInventoryResult(host, model)()
                eel.js_log(f"SUCCESS: Inventario de {host} coletado.", "success")()

            elif task_type == "hvlist":
                # Usamos 'bash -l -c' para simular um login interativo (como no Putty).
                # Isso carrega o perfil do usuário e localiza o comando 'hv' automaticamente no PATH do servidor.
                # get_pty=True garante que o ambiente seja emulado corretamente.
                cmd_hv = "bash -l -c 'hv --listhvs'"
                stdin, stdout, stderr = client.exec_command(cmd_hv, get_pty=True)

                # Aguarda o término do processo
                exit_status = stdout.channel.recv_exit_status()

                # No modo get_pty=True, a saída combinada (stdout + stderr) vem pelo stdout
                full_output = stdout.read().decode('utf-8', errors='ignore')

                final_result_lines = []
                for line in full_output.splitlines():
                    item = line.strip()
                    # Filtro de ruído (password/sudo) e linhas vazias
                    if item and "password" not in item.lower() and "sudo" not in item.lower():
                        final_result_lines.append(line.replace('\r', ''))
                
                final_result = "\n".join(final_result_lines).strip()
                if not final_result:
                    final_result = "Erro: O comando não retornou dados ou o executável 'hv' não foi encontrado."

                eel.updateHvResult(host, final_result)()
                eel.js_log(f"SUCCESS: HV List concluído em {host}", "success")()

            elif task_type == "transfer":
                if local_dir and remote_dir and os.path.exists(local_dir):
                    r_dir = remote_dir.replace('\\', '/')
                    if not r_dir.endswith('/'): r_dir += '/'
                    sftp = client.open_sftp()
                    
                    if os.path.isfile(local_dir):
                        filename = os.path.basename(local_dir)
                        sftp.put(local_dir, r_dir + filename)
                        eel.js_log(f"SUCCESS: Arquivo {filename} enviado para {host}", "success")()
                    else:
                        for filename in os.listdir(local_dir):
                            local_path = os.path.join(local_dir, filename)
                            if os.path.isfile(local_path):
                                sftp.put(local_path, r_dir + filename)
                        eel.js_log(f"SUCCESS: Conteudo de {os.path.basename(local_dir)} enviado para {host}", "success")()
                    sftp.close()

            client.close()
        except Exception as e:
            error_msg = str(e)
            if "Authentication failed" in error_msg:
                eel.js_log(f"ERRO: Senha incorreta em {host}", "error")()
            elif "timeout" in error_msg.lower():
                eel.js_log(f"ERRO: Timeout em {host}", "error")()
            else:
                eel.js_log(f"ERROR em {host}: {error_msg}", "error")()
            
            try:
                if task_type == "inventory":
                    eel.updateInventoryResult(host, "FALHA NA CONEXAO")()
            except: pass

    threading.Thread(target=task_thread, daemon=True).start()
    return {"status": "ok", "message": return_message, "hosts": hosts}

@eel.expose
# Adiciona uma nova tarefa agendada ao armazenamento local.
def add_schedule(task_type, target, time_str):
    data = load_data()
    if "schedules" not in data:
        data["schedules"] = []
    data["schedules"].append({
        "id": len(data["schedules"]) + 1,
        "type": task_type,
        "target": target,
        "time": time_str,
        "status": "Pendente"
    })
    save_data(data)
    return True

# Loop em background que verifica se algum agendamento chegou na hora de executar.
def schedule_checker():
    while True:
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        data = load_data()
        changed = False
        for schedule in data.get("schedules", []):
            if schedule["status"] == "Pendente" and now >= schedule["time"]:
                schedule["status"] = "Executado"
                changed = True
                run_task(schedule["type"], schedule["target"])
        if changed:
            save_data(data)
            eel.refreshSchedules()()
        eel.sleep(10)

threading.Thread(target=schedule_checker, daemon=True).start()

# --- FUNCOES DE BANCO DE DADOS (LOJAS) ---
@eel.expose
# Busca lojas por termo livre e adapta o retorno para o formato esperado pelo JS.
def search_lojas_action(query):
    """Busca lojas para o frontend"""
    results = get_loja(query)
    # Converte os resultados do banco para dicionário que o JS entende
    return [{'id': r[0], 'nome': r[1], 'ip': r[2]} for r in results]

@eel.expose
# Alias mantido para compatibilidade com o nome chamado pelo frontend.
def search_lojas(query):
    return search_lojas_action(query)

@eel.expose
# Insere uma loja individual no banco de dados.
def add_loja_action(id_loja, nome_loja, ip_loja):
    success = add_loja(id_loja, nome_loja, ip_loja)
    return success

@eel.expose
# Retorna a lista completa de lojas cadastradas.
def get_all_lojas_action():
    results = get_all_lojas()
    return [{'id': r[0], 'nome': r[1], 'ip': r[2]} for r in results]

@eel.expose
# Limpa toda a base de lojas cadastrada.
def clear_lojas_action():
    deleted = clear_lojas()
    return {'status': 'ok', 'message': f'{deleted} loja(s) removida(s) da base.'}

@eel.expose
# Atualiza uma loja existente a partir do ID original.
def update_loja_action(original_id, id_loja, nome_loja, ip_loja):
    success = update_loja(original_id, id_loja, nome_loja, ip_loja)
    if success:
        return {'status': 'ok', 'message': f'Loja {id_loja} atualizada com sucesso.'}
    return {'status': 'error', 'message': 'Nao foi possivel atualizar a loja. Verifique duplicidade de ID/IP.'}

@eel.expose
def delete_loja(id_loja):
    """Exclui uma loja específica do banco de dados"""
    try:
        # Aqui chamamos a função que você importou do modules.database
        from modules.database import delete_loja as db_delete
        success = db_delete(id_loja)
        return success
    except Exception as e:
        print(f"Erro ao deletar loja: {e}")
        return False

@eel.expose
# Abre o seletor de arquivos, valida o CSV e devolve o preview para a interface.
def select_csv_file_action():
    global LAST_CSV_PREVIEW, LAST_CSV_FILENAME

    file_path = open_csv_dialog()
    if not file_path:
        return {'status': 'cancelled', 'message': 'Selecao de arquivo cancelada.'}

    try:
        csv_data = read_csv_file_content(file_path)
        parsed = preview_csv_lojas(csv_data)
        if parsed.get('status') == 'ok':
            LAST_CSV_PREVIEW = parsed.get('ready', [])
            LAST_CSV_FILENAME = os.path.basename(file_path)
            parsed['file_name'] = LAST_CSV_FILENAME
        return parsed
    except Exception as exc:
        LAST_CSV_PREVIEW = []
        LAST_CSV_FILENAME = None
        return {'status': 'error', 'message': f'Falha ao abrir o CSV: {exc}'}

@eel.expose
# Leitura legada de CSV por caminho; mantida por compatibilidade com fluxos antigos.
def process_csv_file(file_path):
    """Lê o arquivo CSV e retorna os dados para o front-end validar"""
    try:
        if not os.path.exists(file_path):
            return {'status': 'error', 'message': 'Arquivo não encontrado.'}
            
        records = []
        with open(file_path, mode='r', encoding='utf-8-sig') as f: # utf-8-sig ignora o BOM do Excel
            reader = csv.DictReader(f)
            # Padroniza os nomes das colunas para minusculo
            reader.fieldnames = [name.lower().strip() for name in reader.fieldnames]
            
            for row in reader:
                records.append({
                    'id': row.get('id', '').strip(),
                    'nome': row.get('nome', '').strip(),
                    'ip': row.get('ip', '').strip()
                })
        
        return {'status': 'ok', 'data': records}
    except Exception as e:
        print(f"Erro ao processar CSV: {e}")
        return {'status': 'error', 'message': str(e)}

@eel.expose
# Importa para o banco somente o conjunto validado que ficou salvo em memoria.
def import_selected_csv_action():
    global LAST_CSV_PREVIEW, LAST_CSV_FILENAME
    result = import_csv_lojas(LAST_CSV_PREVIEW)
    if result.get('status') == 'ok':
        LAST_CSV_PREVIEW = []
        LAST_CSV_FILENAME = None
    return result


@eel.expose
# Compara o CSV validado com a base atual e separa o que pode entrar do que sera rejeitado.
def preview_csv_lojas(csv_data):
    parsed = parse_lojas_csv(csv_data)
    if parsed['status'] != 'ok':
        return parsed

    existing_lojas = get_all_lojas_action()
    existing_by_id = {item['id'].lower() for item in existing_lojas}
    existing_by_ip = {item['ip'].lower() for item in existing_lojas}

    ready = []
    rejected = list(parsed['errors'])

    for record in parsed['records']:
        reasons = []
        if record['id'].lower() in existing_by_id:
            reasons.append('ID ja cadastrado')
        if record['ip'].lower() in existing_by_ip:
            reasons.append('IP ja cadastrado')

        if reasons:
            rejected.append({
                'line': record['line'],
                'values': {'id': record['id'], 'nome': record['nome'], 'ip': record['ip']},
                'reason': '; '.join(reasons)
            })
        else:
            ready.append(record)

    return {
        'status': 'ok',
        'message': f'{len(ready)} registro(s) pronto(s) para importacao.',
        'ready': ready,
        'rejected': rejected,
        'total_rows': parsed['total_rows'],
        'preview_limit': CSV_PREVIEW_LIMIT
    }

@eel.expose
# Persiste em lote os registros aprovados pelo preview de importacao.
def import_csv_lojas(records):
    if not isinstance(records, list) or not records:
        return {'status': 'error', 'message': 'Nenhum registro validado para importar.', 'imported': 0}

    imported, rejected = add_lojas_batch(records)

    status = 'ok' if imported else 'error'
    message = f'{imported} loja(s) importada(s) com sucesso.' if imported else 'Nenhuma loja foi importada.'
    return {
        'status': status,
        'message': message,
        'imported': imported,
        'rejected': rejected
    }

# Envia o relatório de uso antes de subir a interface
threading.Thread(target=send_telemetry_startup, daemon=True).start()

# Iniciar aplicacao
# Sobe o frontend HTML com janela desktop via Eel.
eel.start('index.html', size=(1180, 920))
