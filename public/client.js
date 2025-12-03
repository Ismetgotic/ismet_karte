const socket = io();

let myIndex = null;
let currentRoom = null;
let gameState = null;

const joinBtn = document.getElementById('joinBtn');
const roomCodeInput = document.getElementById('roomCode');
const playerNameInput = document.getElementById('playerName');
const lobbyStatus = document.getElementById('lobbyStatus');
const playersList = document.getElementById('playersList');
const lobbyEl = document.getElementById('lobby');
const gameEl = document.getElementById('game');
const statusBar = document.getElementById('statusBar');

const rulesToggle = document.getElementById('rulesToggle');
const rulesPanel = document.getElementById('rulesPanel');
const rulesToggleState = document.getElementById('rulesToggleState');

rulesToggle.addEventListener('click', () => {
  const isOpen = rulesPanel.style.display === 'block';
  rulesPanel.style.display = isOpen ? 'none' : 'block';
  rulesToggleState.textContent = isOpen ? '(prikaži)' : '(sakrij)';
});

const handEls = {
  0: document.getElementById('hand-0'),
  1: document.getElementById('hand-1'),
  2: document.getElementById('hand-2'),
  3: document.getElementById('hand-3')
};
const nameEls = {
  0: document.getElementById('player-0-name'),
  1: document.getElementById('player-1-name'),
  2: document.getElementById('player-2-name'),
  3: document.getElementById('player-3-name')
};
const tablePileEl = document.getElementById('tablePile');
const scoreAEl = document.getElementById('scoreA');
const scoreBEl = document.getElementById('scoreB');
const winnerText = document.getElementById('winnerText');
const deckCountEl = document.getElementById('deckCount');
const lampA = document.getElementById('lampA');
const lampB = document.getElementById('lampB');
const decisionButtons = document.getElementById('decisionButtons');
const btnKupim = document.getElementById('btnKupim');
const btnNosiProtivnik = document.getElementById('btnNosiProtivnik');

joinBtn.addEventListener('click', () => {
  const roomCode = roomCodeInput.value.trim() || 'KARTA';
  const playerName = playerNameInput.value.trim() || 'Igrač';

  joinBtn.disabled = true;
  lobbyStatus.textContent = 'Povezivanje...';

  socket.emit('joinRoom', { roomCode, playerName }, (res) => {
    if (!res || !res.success) {
      lobbyStatus.textContent = res && res.message ? res.message : 'Neuspješno spajanje.';
      joinBtn.disabled = false;
      return;
    }
    currentRoom = res.roomCode;
    myIndex = res.playerIndex;
    lobbyStatus.textContent = `Spojen u sobu: ${currentRoom}. Tvoj broj igrača: ${myIndex}. Čeka se da vas bude 4...`;
    socket.emit('requestGameState', { roomCode: currentRoom });
  });
});

socket.on('roomUpdate', (data) => {
  if (!data) return;
  const players = data.players || [];
  const list = players.map((p, i) => {
    return `${i}: ${p.name}`;
  }).join('<br>');
  playersList.innerHTML = 'Igrači u sobi:<br>' + list;

  if (data.scores) {
    scoreAEl.textContent = `Tim A (0 + 2): ${data.scores.teamA}`;
    scoreBEl.textContent = `Tim B (1 + 3): ${data.scores.teamB}`;
  }
});

socket.on('gameState', (state) => {
  gameState = state;
  lobbyEl.style.display = 'none';
  gameEl.style.display = 'block';
  renderGame(state);
});

function playCard(cardId) {
  if (!currentRoom || myIndex === null) return;
  socket.emit('playCard', { roomCode: currentRoom, cardId });
}

function sendPickupDecision(choice) {
  if (!currentRoom || myIndex === null) return;
  socket.emit('pickupDecision', { roomCode: currentRoom, choice });
}

btnKupim.addEventListener('click', () => {
  sendPickupDecision('me');
});

btnNosiProtivnik.addEventListener('click', () => {
  sendPickupDecision('opponent');
});

function renderGame(state) {
  if (!state) return;

  if (state.players && state.players.length === 4) {
    state.players.forEach((p, idx) => {
      if (nameEls[idx]) {
        if (idx === myIndex) {
          nameEls[idx].textContent = p.name + ' (Ti)';
        } else {
          nameEls[idx].textContent = p.name;
        }
      }
    });
  }

  const players = state.players || [];
  const name0 = players[0] && players[0].name ? players[0].name : "0";
  const name1 = players[1] && players[1].name ? players[1].name : "1";
  const name2 = players[2] && players[2].name ? players[2].name : "2";
  const name3 = players[3] && players[3].name ? players[3].name : "3";

  scoreAEl.textContent = `Tim A: ${name0} i ${name2}: ${state.teams.scoreA}`;
  scoreBEl.textContent = `Tim B: ${name1} i ${name3}: ${state.teams.scoreB}`;

  updateLeadLamps(state);

  if (state.phase === 'finished' && state.winnerTeam) {
    winnerText.textContent = state.winnerTeam === 'A' ? 'Pobjednik: Tim A' : 'Pobjednik: Tim B';
    statusBar.textContent = 'Igra završena. Osvježite stranicu ili uđite ponovo u sobu za novu partiju.';
  } else {
    winnerText.textContent = '';
  }

  const deckLen = state.deck ? state.deck.length : 0;
  deckCountEl.textContent = `Špil: ${deckLen}`;

  renderHands(state);
  renderTablePile(state);
  renderStatus(state);
  renderDecisionButtons(state);
}

function makeLabel(rank, suit) {
  return `${rank}${suit}`;
}

function isRedSuit(suit) {
  return suit === '♥' || suit === '♦';
}


function updateLeadLamps(state) {
  if (!lampA || !lampB) return;
  lampA.classList.remove('on');
  lampB.classList.remove('on');

  if (state.phase !== 'playing') return;
  if (!state.table || state.table.length === 0) return;
  if (typeof state.leadOwner !== 'number') return;

  const teamA = state.teams.teamA || [];
  if (teamA.includes(state.leadOwner)) {
    lampA.classList.add('on');
  } else {
    lampB.classList.add('on');
  }
}

function renderHands(state) {
  for (let p = 0; p < 4; p++) {
    const handEl = handEls[p];
    if (!handEl) continue;
    handEl.innerHTML = '';

    const isMe = (p === myIndex);
    const isTurn = (p === state.currentTurn);
    const hand = state.hands[p] || [];

    hand.forEach((card) => {
      const div = document.createElement('div');
      div.classList.add('card');

      if (!isMe) {
        div.classList.add('back');
        const face = document.createElement('div');
        face.classList.add('card-face');
        face.textContent = '🂠';
        div.appendChild(face);
      } else {
        const label = makeLabel(card.rank, card.suit);
        div.setAttribute('data-label', label);
        div.classList.add(isRedSuit(card.suit) ? 'red' : 'black');

        const face = document.createElement('div');
        face.classList.add('card-face');
        face.textContent = label;
        div.appendChild(face);

        if (state.phase !== 'playing') {
          div.classList.add('disabled');
        } else if (state.specialExtensionAllowed &&
                   state.startingPlayer === myIndex &&
                   state.currentTurn === myIndex) {

          const canExtend = (card.rank === state.firstCardRank || card.rank === '7') &&
                            state.playsInTrick < 16;

          if (!canExtend) {
            div.classList.add('disabled');
          } else {
            div.classList.add('me-turn');
            div.addEventListener('click', () => {
              playCard(card.id);
            });
          }
        } else if (!isTurn) {
          div.classList.add('disabled');
        } else {
          div.classList.add('me-turn');
          div.addEventListener('click', () => {
            playCard(card.id);
          });
        }
      }

      handEl.appendChild(div);
    });
  }
}

function renderTablePile(state) {
  tablePileEl.innerHTML = '';
  const pile = state.table || [];
  const n = pile.length;
  if (n === 0) return;

  const mainOffset = 40;  // prva karta više izvučena
  const extraOffset = 18; // svaka naredna duplo manje

  pile.forEach((entry, i) => {
    const div = document.createElement('div');
    div.classList.add('card', 'pile-card');

    const label = makeLabel(entry.card.rank, entry.card.suit);
    div.setAttribute('data-label', label);
    div.classList.add(isRedSuit(entry.card.suit) ? 'red' : 'black');

    const face = document.createElement('div');
    face.classList.add('card-face');
    face.textContent = label;
    div.appendChild(face);

    // i = 0 je prva odigrana (na dnu), zadnja je na vrhu
    const offset = i === 0 ? 0 : mainOffset + (i - 1) * extraOffset;
    div.style.top = offset + 'px';
    div.style.zIndex = 10 + i;

    const teamA = state.teams.teamA;
    if (teamA.includes(entry.playerIndex)) {
      div.classList.add('teamA');
    } else {
      div.classList.add('teamB');
    }

    tablePileEl.appendChild(div);
  });
}

function renderStatus(state) {
  if (state.phase === 'lobby') {
    statusBar.textContent = 'Čeka se početak igre...';
    return;
  }
  if (state.phase === 'finished') {
    return;
  }

  const players = state.players || [];
  const current = state.currentTurn;
  const currentName =
    players && players[current] && players[current].name
      ? players[current].name
      : `Igrač ${current}`;

  let txt = '';
  if (current === myIndex) {
    txt = 'Tvoj red je.';
    if (state.specialExtensionAllowed && state.startingPlayer === myIndex) {
      if (state.leadOwner !== state.startingPlayer) {
        txt = 'Tvoj red je. Ne držiš više vodstvo – možeš produžiti (ista cifra ili 7) ili "Nosi".';
      } else {
        txt = 'Tvoj red je. Možeš produžiti (ista cifra ili 7) ili "Kupim" / "Nosi".';
      }
    }
  } else {
    txt = `Na potezu je igrač: ${currentName}.`;
  }
  statusBar.textContent = txt;
}

function renderDecisionButtons(state) {
  const show =
    state.phase === 'playing' &&
    state.specialExtensionAllowed &&
    state.startingPlayer === myIndex &&
    state.currentTurn === myIndex;

  if (!show) {
    decisionButtons.style.display = 'none';
    return;
  }

  decisionButtons.style.display = 'flex';

  const kupimAllowed = state.leadOwner === state.startingPlayer;
  btnKupim.disabled = !kupimAllowed;
  btnNosiProtivnik.disabled = false;
}