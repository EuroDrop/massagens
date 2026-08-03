# Massage Credits — PWA privada

Aplicação móvel em HTML, CSS e JavaScript puro para gerir créditos de massagens, cupões e sessões ao minuto. Todos os dados são guardados localmente no dispositivo através de `localStorage`.

## Conteúdo da pasta

- `index.html` — estrutura da aplicação
- `style.css` — interface escura, premium, responsiva e mobile-first
- `app.js` — créditos, cupões, temporizador, histórico, níveis, recompensas e painel admin
- `manifest.json` — configuração de instalação PWA
- `service-worker.js` — cache básico para utilização offline
- `icons/` — ícones de 192 px, 512 px e versão maskable para Android

## Teste imediato

A aplicação inicia com 80 créditos e PIN admin `1234`, para permitir testar imediatamente compras, cupões e sessões ao minuto.

Pode abrir diretamente o ficheiro `index.html`, mas a instalação PWA e o service worker exigem que a aplicação seja servida por HTTP em `localhost` ou por HTTPS num domínio.

Para testar no computador, abra a pasta do projeto num terminal e execute:

```bash
python -m http.server 8080
```

Depois abra `http://localhost:8080` no Chrome.

## Colocação no alojamento

Copie todo o conteúdo da pasta para a pasta pública do alojamento, por exemplo:

- `public_html/`
- `www/`
- a raiz pública do domínio ou subdomínio

Mantenha a estrutura original. O ficheiro `index.html`, o `manifest.json`, o `service-worker.js` e a pasta `icons` devem conservar as respetivas posições relativas.

O domínio deve usar HTTPS. Sem HTTPS, os navegadores não ativam normalmente a instalação PWA nem o funcionamento offline do service worker.

Exemplo de estrutura no alojamento:

```text
public_html/
├── index.html
├── style.css
├── app.js
├── manifest.json
├── service-worker.js
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

Depois de substituir ficheiros numa atualização futura, altere o valor de `CACHE_NAME` em `service-worker.js`, por exemplo de `massage-credits-v1.0.0` para `massage-credits-v1.0.1`, para forçar a atualização do cache instalado.

## Instalação num Samsung/Android

### Samsung Internet

1. Abra o endereço HTTPS da aplicação.
2. Toque no menu do navegador.
3. Escolha `Adicionar página a`.
4. Escolha `Ecrã principal` ou `Instalar aplicação Web`, conforme a versão.
5. Confirme a instalação.

### Google Chrome

1. Abra o endereço HTTPS da aplicação.
2. Toque no menu de três pontos.
3. Escolha `Instalar aplicação` ou `Adicionar ao ecrã principal`.
4. Confirme em `Instalar`.

Depois de instalada, a aplicação abre em modo standalone, sem a barra normal do navegador.

## Alterar o PIN

O PIN inicial é `1234`.

Na aplicação:

1. Abra `Admin`.
2. Introduza o PIN atual.
3. Vá a `Alterar PIN`.
4. Indique o PIN atual e o novo PIN, com 4 a 8 algarismos.

No código, o PIN inicial para novas instalações está em `app.js`:

```javascript
const DEFAULT_PIN = '1234';
```

Alterar este valor no código não substitui um PIN já guardado no dispositivo. Para uma instalação existente, altere o PIN no próprio painel admin.

## Alterar preços dos cupões

A forma mais simples é usar `Admin > Gerir cupões`, onde pode criar, editar, ativar, desativar ou apagar cupões.

Os cupões iniciais para novas instalações estão definidos na função `defaultCoupons()` do ficheiro `app.js`. Cada cupão tem:

```javascript
{
  id: 'coupon-10-min',
  name: 'Massagem de 10 minutos',
  description: 'Descrição do cupão',
  price: 15,
  durationMinutes: 10,
  active: true
}
```

## Alterar o preço por minuto

Na aplicação, use `Admin > Preço por minuto`.

O valor inicial para novas instalações está em `createDefaultState()` no ficheiro `app.js`:

```javascript
minutePrice: 1,
```

A cobrança é feita por minuto iniciado. O primeiro minuto é debitado quando a sessão começa e a aplicação termina automaticamente quando não existir saldo para iniciar o minuto seguinte.

## Armazenamento e privacidade

Os dados ficam apenas no `localStorage` do navegador e do dispositivo onde a aplicação é usada. Não existe sincronização entre telemóveis, contas, servidores ou navegadores.

O PIN é uma proteção de utilização familiar dentro da interface. Como não existe backend nem encriptação externa, não deve ser considerado um mecanismo de segurança para dados sensíveis.

Apagar os dados do site no navegador elimina o saldo, os cupões, o histórico, o PIN alterado e as estatísticas desse dispositivo.
