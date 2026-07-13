# Inventario OCR

Web app para ler um numero de inventario pela camara ou por imagem, procurar esse valor numa coluna unica de um ou mais ficheiros Excel guardados no servidor e mostrar a linha encontrada.

## Como testar no computador

```bash
npm install
npm run dev
```

Depois abre:

```text
http://localhost:5173/
```

A API fica em:

```text
http://localhost:3000/
```

## Como usar

1. Carrega um ou mais ficheiros `.xlsx`, `.xls` ou `.csv`.
2. Escolhe a coluna que contem o numero unico de inventario.
3. Abre a camara ou escolhe uma imagem.
4. Confirma o texto reconhecido no campo editavel.
5. Carrega em `Procurar`.

Depois do upload, os dados ficam guardados em:

```text
data/inventory.json
```

Enquanto esse ficheiro existir no servidor, os utilizadores nao precisam de carregar os Excels outra vez. Se carregares novamente um ficheiro com o mesmo nome, a app substitui os registos antigos desse ficheiro.

## Nota sobre telemoveis

Para usar a camara num telemovel, a app deve estar publicada em HTTPS. Em desenvolvimento, `localhost` funciona no computador, mas um endereco local como `http://10.x.x.x:5173` pode nao ter permissao de camara em alguns browsers.

Para criar um link HTTPS temporario:

```bash
npm run dev
npm run tunnel
```

O comando `tunnel` devolve um link `https://...trycloudflare.com`. Esse link so funciona enquanto o computador estiver ligado e os dois comandos estiverem a correr.

## Proxima evolucao recomendada

Para uso real em qualquer telemovel pela internet, o ideal e publicar a app com:

- HTTPS.
- Protecao por palavra-passe na area de upload.
- Armazenamento persistente do ficheiro/dados.
- Backups do ficheiro `data/inventory.json` ou migracao para base de dados.

## GitHub Pages vs servidor

A app tambem funciona em GitHub Pages para consulta: nesse modo ela usa `public/inventory.json`, que ja contem os dados convertidos.

GitHub Pages nao consegue guardar novos Excels enviados no browser. Para os colegas carregarem muitos Excels diretamente pela app, e preciso publicar a versao com servidor Node (`server.js`) num alojamento com armazenamento persistente.
