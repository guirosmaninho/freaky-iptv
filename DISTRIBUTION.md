# Distribuição Windows e macOS

## Criar uma release completa

Na raiz do repositório, executar:

```powershell
.\build-windows-release.cmd
```

O ficheiro instala as dependências fixadas no `package-lock.json` e depois executa `npm run release:win`.

Este comando executa testes, lint, build TypeScript/Vite, publica os helpers .NET self-contained, corre os testes E2E, cria os dois pacotes Windows e valida o conteúdo e o arranque da aplicação empacotada.

Os ficheiros finais ficam em `release/`:

- `Freaky-IPTV-<versão>-Portable-x64.exe`: aplicação portátil, sem instalação.
- `Freaky-IPTV-Setup-<versão>-x64.exe`: instalador com atalhos no Ambiente de Trabalho e menu Iniciar.

O utilizador final não precisa de Node.js, .NET, VLC ou FFmpeg. Num Windows limpo de 64 bits basta abrir o portátil ou executar o instalador. A playlist e o EPG continuam a exigir acesso à Internet.

Para gerar apenas os pacotes e respetiva verificação, sem executar toda a suite de qualidade:

```powershell
npm run package:win
```

## Requisitos do computador de build

- Windows x64.
- Node.js 22 e npm.
- .NET 8 SDK x64.
- Acesso à Internet na primeira instalação/build para restaurar pacotes npm, NuGet e ferramentas do electron-builder.

Para macOS, o computador de build precisa de macOS, Node.js 22, .NET 8 SDK e as ferramentas de linha de comandos do Xcode. O pipeline prepara também o FFmpeg correspondente a cada arquitetura, incluindo quando os dois destinos são compilados no mesmo Mac. Os comandos abaixo produzem um DMG nativo para cada arquitetura:

```sh
npm run release:mac
```

Para criar e validar apenas os DMGs, sem executar a suite completa de release:

```sh
npm run package:mac
```

Os artefactos ficam em `release/`:

- `Freaky-IPTV-<versão>-mac-x64.dmg` para Macs Intel;
- `Freaky-IPTV-<versão>-mac-arm64.dmg` para Macs Apple Silicon.

Os DMGs macOS não são assinados nem notarizados, porque o projeto não usa uma Apple Developer account. Depois de copiar a app para Applications e tentar abri-la, o utilizador deve abrir **Definições do Sistema → Privacidade e Segurança** e selecionar **Abrir mesmo assim**. Este passo pode ser repetido para uma nova versão descarregada. Consulte as [instruções da Apple](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/26/mac/26).

## Release para ambas as plataformas

Com o GitHub CLI autenticado (`gh auth login`), executar:

```sh
npm run release:all
```

O comando inicia o workflow manual `Release`: compila e valida Windows, macOS Intel e macOS Apple Silicon em runners nativos e cria/atualiza a release GitHub `v<versão>` com todos os artefactos. O comando não altera a versão; atualize `package.json` e `package-lock.json` antes de o usar.

## Versões e atualizações

Antes de cada publicacao, alterar `version` em `package.json` e `package-lock.json`. O `appId` e a identidade NSIS sao estaveis, por isso um instalador com versao superior atualiza a instalacao existente sem apagar as definicoes do utilizador.

O processo principal, os atalhos, a janela e os metadados do ficheiro usam o nome `Freaky IPTV`; `electron.exe` não é distribuído como nome da aplicação. A logo `public/cat_icon.png` é convertida para um ícone Windows e incorporada no executável, instalador e atalhos.

A app so verifica atualizacoes quando o utilizador seleciona Procurar atualizacoes no About. Cada GitHub Release deve incluir o instalador NSIS, o respetivo `.blockmap`, `latest.yml`, o executavel portatil e os dois DMGs macOS. No Windows, o instalador descarrega e instala apos confirmacao; o portatil e substituido no mesmo diretorio quando a app reinicia. No macOS, a app compara a versão e abre a página da release no navegador, onde o utilizador descarrega o DMG adequado. Nao alterar `build.appId` depois da primeira publicacao.

## Assinatura digital

Uma release sem assinatura funciona, mas o Windows SmartScreen pode mostrar um aviso. Uma assinatura pública requer um certificado de code signing emitido para o responsável pela aplicação. Esse certificado não pode ser criado de forma confiável pelo projeto.

O electron-builder utiliza automaticamente um certificado quando estas variáveis estão definidas:

```powershell
$env:CSC_LINK = "C:\caminho\certificado.pfx"
$env:CSC_KEY_PASSWORD = "palavra-passe-do-certificado"
npm run release:win
```

Também é possível fornecer `CSC_LINK` como uma variável secreta de CI. Nunca guardar o ficheiro `.pfx` ou a palavra-passe no repositório. A primeira assinatura pode ainda apresentar SmartScreen até o certificado ganhar reputação.
