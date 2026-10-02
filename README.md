# RIVER RAID 2600

River Raid para o navegador, desenvolvido em JavaScript e jogável offline com teclado, toque ou gamepad.

Pilote o avião pelo rio, destrua inimigos e pontes e abasteça nos depósitos FUEL. Evite as margens e as ilhas para conservar seus aviões e aumentar a pontuação.

## Como jogar

Abra [index.html](index.html) diretamente no navegador ou use [dist/riverraid-2600.html](dist/riverraid-2600.html), que reúne o jogo em um único arquivo HTML. Ambas as versões funcionam offline, sem instalação.

Para executar o servidor local, use Node.js 20 ou superior:

```bash
npm start
```

Abra `http://localhost:3000`. As variáveis `PORT` e `HOST` permitem configurar a porta e o endereço do servidor.

| Controle | Ação |
| --- | --- |
| ← / → ou A / D | Inclinar o avião para esquerda / direita |
| ↑ / ↓ ou W / S | Acelerar / desacelerar; o rio continua avançando |
| Espaço / Z / X | Disparar; mantenha pressionado para tiro contínuo |
| Enter | Iniciar, decolar ou alternar pausa durante o voo |
| P | Pausar / continuar |
| R | Reiniciar a partida |
| M | Ligar / desligar o som |
| C | Alternar TV colorida / preto e branco |
| L | Alternar dificuldade B / A |
| 1 / 2 | Selecionar jogo solo / dois jogadores alternados |
| F | Alternar tela cheia, quando disponível no navegador |

No celular, use o direcional e o botão vermelho FIRE. Os controles aceitam dois dedos ao mesmo tempo e permitem deslizar entre as setas. Manter a tela pressionada também dispara. No gamepad, use o manche esquerdo ou o direcional, um botão de ação para disparar e START para iniciar ou pausar. Os dois jogadores compartilham os controles e alternam após perder um avião. Ao sair da janela ou trocar de aba, a partida pausa automaticamente.

## Regras

- Você começa com um avião em voo e três aviões em reserva. Recebe uma reserva adicional a cada 10.000 pontos, até nove reservas.
- Atingir margens, ilhas, navios, helicópteros, jatos ou uma ponte intacta destrói o avião. Esgotar o combustível também destrói o avião.
- O combustível é consumido a uma taxa constante, independentemente da velocidade. Abaixo de um quarto do tanque, soa a sirene. Voe sobre um depósito FUEL para abastecer; desacelerar prolonga o abastecimento. O som fica mais agudo quando o tanque está cheio.
- Um depósito pode ser destruído e vale pontos, inclusive durante o abastecimento. Decida entre conservar combustível e aumentar a pontuação.
- Destruir uma ponte abre a passagem e estabelece imediatamente o ponto de retorno no trecho seguinte. Após perder um avião, o tanque volta cheio e o trecho recomeça; a pontuação permanece.
- Na dificuldade B, mover o avião também guia o míssil já disparado. Na dificuldade A, o míssil segue em linha reta.
- No jogo 2, cada jogador conserva sua pontuação, reservas e ponto de retorno. O segundo jogador pilota um avião preto.
- O recorde fica salvo no `localStorage`, quando o navegador permite. Ao alcançar um milhão de pontos, o placar mostra `!!!!!!`, como no manual original.

| Alvo | Pontos |
| --- | ---: |
| Navio | 30 |
| Helicóptero | 60 |
| Depósito de combustível | 80 |
| Jato | 100 |
| Ponte | 500 |

## Estrutura

- `index.html` e `css/style.css`: página, TV, chaves, instruções, estados acessíveis e controles de toque.
- `js/config.js`: dimensões, paleta, velocidades, combustível e pontuação.
- `js/sprites.js`: bitmaps de aviões, inimigos, depósitos, explosões, casas, árvores e letras.
- `js/world.js`: margens, ilhas, alvos, pontes e geração determinística de trechos; mantém apenas o entorno da partida em memória.
- `js/game.js`: simulação independente do DOM, colisões, tiro guiado, combustível, reservas, dois jogadores, pontos de retorno, placar, renderização e loop do navegador.
- `js/input.js`: teclado, botões, múltiplos ponteiros e Gamepad API; libera as entradas ao perder o foco.
- `js/audio.js`: síntese Web Audio iniciada após uma interação do jogador.
- `tools/build-artifact.js`: geração da versão HTML portátil.
- `tools/serve.js`: servidor estático local sem dependências.
- `tools/test.js` e `tools/browser-test.js`: verificações do motor e do jogo no Chromium.

## Desenvolvimento

Os testes do motor e da simulação de voo usam apenas o Node.js:

```bash
npm test
npm run test:flight
```

Para executar os testes no Chromium, instale as dependências de desenvolvimento e o navegador:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Os testes de navegador verificam teclado, gamepad, multitoque, pausa, recorde, controles do console, layout responsivo e funcionamento offline. As capturas de tela ficam em `test-results/`.

Após alterar os arquivos do jogo, atualize a versão HTML portátil:

```bash
npm run build
```

## Sobre a recriação

O jogo original foi criado por Carol Shaw e publicado pela Activision em 1982 para o Atari 2600. As referências desta versão são o [manual original](https://atariage.com/manual_html_page.php?SoftwareLabelID=409) e as capturas preservadas pelo AtariAge: [1](https://atariage.com/2600/screenshots/s_RiverRaid_1.png), [2](https://atariage.com/2600/screenshots/s_RiverRaid_2.png) e [3](https://atariage.com/2600/screenshots/s_RiverRaid_3.png).

Esta versão usa sprites em bitmap, áudio sintetizado e uma tela com aspecto 4:3. O rio segue o gerador determinístico do cartucho: o mesmo LFSR de 16 bits, trechos de 16 blocos fechados por uma ponte, margens em degraus e ilhas centrais. A dificuldade sobe porque o vale pode estreitar e porque passam a surgir mais inimigos do que depósitos.
