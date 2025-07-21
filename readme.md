# Plataforma de Simulados

Uma aplicação web direta e eficiente para criar e realizar simulados. O backend é construído com Python/Flask e o frontend com JavaScript puro, tudo containerizado com Docker para uma configuração e execução simplificadas.

## Visão Geral

-   **Backend**: API em Flask que serve os simulados a partir de arquivos JSON.
-   **Frontend**: Interface de usuário em JavaScript vanilla, HTML e CSS, servida pelo Nginx.
-   **Containerização**: `Docker Compose` orquestra os serviços de backend e frontend.
-   **Segurança**: Nginx configurado para HTTPS com certificados autoassinados e cabeçalhos de segurança.

## Funcionalidades

-   **Carregamento Dinâmico**: Os simulados são carregados a partir de arquivos JSON.
-   **Quiz Interativo**: Interface limpa para responder às questões.
-   **Ordem Aleatória**: As questões e alternativas são embaralhadas a cada tentativa.
-   **Modo Revisão**: Ao final, repasse apenas as questões que você errou.
-   **Persistência de Progresso**: Continue um simulado de onde parou (`localStorage`).
-   **Marcação de Questões**: Marque questões para rever mais tarde com categorias.
-   **Tema Claro/Escuro**: Suporte a temas com salvamento da preferência.

## Stack

-   **Backend**: Python, Flask, Gunicorn
-   **Frontend**: JavaScript (Vanilla), HTML5, CSS3
-   **Servidor/Proxy**: Nginx
-   **Infraestrutura**: Docker, Docker Compose

## Como Usar

### Pré-requisitos

-   [Docker](https://www.docker.com/)
-   [Docker Compose](https://docs.docker.com/compose/)

### Execução

1.  **Adicione seus Simulados**
    -   Crie um diretório chamado `simulados` dentro da pasta `backend`.
    -   Adicione seus arquivos `.json` nesse diretório. Use o formato abaixo.

2.  **Inicie a Aplicação**
    ```bash
    docker-compose up -d --build
    ```

3.  **Acesse no Navegador**
    -   Abra **`https://localhost:10443`**.
    -   Ignore o aviso de segurança do navegador (o certificado SSL é autoassinado).
    -   A versão HTTP em `http://localhost:10080` redirecionará automaticamente para HTTPS.

### Formato do JSON do Simulado

Crie um arquivo `meu_simulado.json` dentro de `backend/simulados/`:

```json
{
  "titulo": "Título do Simulado",
  "descricao": "Uma breve descrição sobre o que este simulado aborda.",
  "questoes": [
    {
      "enunciado": "Qual tecnologia é usada para containerizar esta aplicação?",
      "alternativas": [
        "Kubernetes",
        "Docker",
        "Vagrant"
      ],
      "alternativa_correta": "Docker",
      "explicacao": "Docker é utilizado para criar, implantar e executar aplicações em contêineres."
    }
  ]
}
```