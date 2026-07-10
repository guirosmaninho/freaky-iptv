# Distribuição Windows

## Criar uma release completa

Na raiz do repositório, executar:

```powershell
.\build-windows-release.cmd
```

O ficheiro instala as dependências fixadas no `package-lock.json` e depois executa `npm run release:win`.

Este comando executa testes, lint, build TypeScript/Vite, publica os helpers .NET self-contained, corre os testes E2E, cria os dois pacotes Windows e valida o conteúdo e o arranque da aplicação empacotada.

Os ficheiros finais ficam em `release/`:

- `Freaky-IPTV-1.0.1-Portable-x64.exe`: aplicação portátil, sem instalação.
- `Freaky-IPTV-Setup-1.0.1-x64.exe`: instalador com atalhos no Ambiente de Trabalho e menu Iniciar.

O utilizador final não precisa de Node.js, .NET, VLC ou FFmpeg. Num Windows limpo de 64 bits basta abrir o portátil ou executar o instalador. A playlist e o EPG continuam a exigir acesso à Internet.

Para gerar apenas os pacotes e respetiva verificação, sem executar toda a suite de qualidade:

```powershell
npm run package:win
```

## Requisitos do computador de build

- Windows x64.
- Node.js e npm.
- .NET 8 SDK x64.
- Acesso à Internet na primeira instalação/build para restaurar pacotes npm, NuGet e ferramentas do electron-builder.

## Versões e atualizações

Antes de cada publicacao, alterar `version` em `package.json` e `package-lock.json`. O `appId` e a identidade NSIS sao estaveis, por isso um instalador com versao superior atualiza a instalacao existente sem apagar as definicoes do utilizador.

O processo principal, os atalhos, a janela e os metadados do ficheiro usam o nome `Freaky IPTV`; `electron.exe` não é distribuído como nome da aplicação. A logo `public/cat_icon.png` é convertida para um ícone Windows e incorporada no executável, instalador e atalhos.

A app so verifica atualizacoes quando o utilizador seleciona Procurar atualizacoes no About. Cada GitHub Release deve incluir o instalador NSIS, o respetivo `.blockmap`, `latest.yml` e o executavel portatil. O instalador descarrega e instala apos confirmacao; o portatil e substituido no mesmo diretorio quando a app reinicia. Nao alterar `build.appId` depois da primeira publicacao.

## Assinatura digital

Uma release sem assinatura funciona, mas o Windows SmartScreen pode mostrar um aviso. Uma assinatura pública requer um certificado de code signing emitido para o responsável pela aplicação. Esse certificado não pode ser criado de forma confiável pelo projeto.

O electron-builder utiliza automaticamente um certificado quando estas variáveis estão definidas:

```powershell
$env:CSC_LINK = "C:\caminho\certificado.pfx"
$env:CSC_KEY_PASSWORD = "palavra-passe-do-certificado"
npm run release:win
```

Também é possível fornecer `CSC_LINK` como uma variável secreta de CI. Nunca guardar o ficheiro `.pfx` ou a palavra-passe no repositório. A primeira assinatura pode ainda apresentar SmartScreen até o certificado ganhar reputação.
