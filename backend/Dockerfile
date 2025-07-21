# Use uma imagem base Python slim para um tamanho menor.
FROM python:3.9-slim

# Crie um usuário e grupo não-root para executar a aplicação.
RUN addgroup --system app && adduser --system --group appuser

# Defina o diretório de trabalho.
WORKDIR /app

# Copie o arquivo de dependências.
COPY requirements.txt .

# Instale as dependências.
RUN pip install --no-cache-dir -r requirements.txt

# Copie o código da aplicação para o contêiner.
COPY . .

# Mude a propriedade dos arquivos para o novo usuário.
RUN chown -R appuser:app /app

# Mude para o usuário não-root.
USER appuser

# Exponha a porta que o Gunicorn irá usar.
EXPOSE 5000

# Use Gunicorn como o servidor de produção WSGI.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "app:app"]