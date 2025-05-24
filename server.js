const express = require("express");
const http = require("http");
const cors = require("cors");
const {v4: uuidv4} = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const suits = ["Clubs", "Spades", "Diamonds", "Hearts"];
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
const values = Object.fromEntries(ranks.map((r) => [r, parseInt(r)]));

const MAX_PLAYERS = 4;
let players = [];
let deck = [];

let centerCard = null;
let currentTurnIndex = 0;


function shuffleDeck(deck){
  for (let i = deck.length -1; i > 0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

createDeck();

function createDeck() {
  deck = [];
  for (let suit of suits)
    for (let rank of ranks)
      deck.push({ suit, rank, value: values[rank] });
  shuffleDeck(deck);

}

function nextTurn() {
  const previousTurn = currentTurnIndex;
  currentTurnIndex = (currentTurnIndex + 1) % players.length;
  console.log(`turn changed: ${previousTurn} -> ${currentTurnIndex}`);
}


const { Mars } = require("lucide-react");

app.post("/join", (req, res) => {
  try {
    if (players.length >= MAX_PLAYERS) {
      return res.status(400).json({
        status: 'error',
        message: 'Game is full'
      });
    }

    const playerID = uuidv4(); 
    const newPlayer = {
      id: playerID,
      hand: drawHand(), 
      index: players.length,
      lastSeen: Date.now()
    };

    players.push(newPlayer);
    console.log(`Player ${newPlayer.index} joined the game. Total players: ${players.length}`);

    res.json({
      status: 'ok', 
      message: `Joined as player ${newPlayer.index}`,
      player_id: playerID,
      player_index: newPlayer.index, 
      hand: newPlayer.hand, 
      center_card: getCenterCard(), 
      current_turn_index: currentTurnIndex,
      total_players: players.length
    });
  } catch (error) {
    console.error('Error in join:', error);
    res.status(500).json({
      status: 'error',
    });
  }
});

app.post("/play_card", (req, res) => {
  try {
    const { player_index, card } = req.body;

    if (player_index === undefined || card === undefined) {
      return res.status(400).json({
        status: "error",
        message: "Missing required parameters"
      });
    }

    console.log(`${currentTurnIndex}`);
    console.log(`${player_index}`);
    console.log(`${players.length}`);
    console.log(`${players.map(p => p.index).join(', ')}`);

    if (player_index !== currentTurnIndex) {
      return res.status(403).json({ 
        status: "error", 
        message: `not ur turn current turn: ${currentTurnIndex} ur index: ${player_index}`,
        game_state: {
          current_turn: currentTurnIndex,
          total_players: players.length,
          active_players: players.map(p => p.index)
        }
      });
    }

    const player = players.find(p => p.index === player_index);
    if (!player) {
      return res.status(404).json({
        status: "error",
        message: "Player not found"
      });
    }

    centerCard = card;
    nextTurn();
    console.log(`Player ${player_index} played card. Next turn: ${currentTurnIndex}`);

    res.json({
      status: "ok",
      message: "Card played",
      center_card: centerCard,
      current_turn_index: currentTurnIndex,
      total_players: players.length,
      active_players: players.map(p => p.index)
    });
  } catch (error) {
    console.error('Error in play_card:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

app.get("/state", (req, res) => {
  try {
    res.json({
      center_card: centerCard,
      current_turn_index: currentTurnIndex,
      deck_count: deck.length,
      total_players: players.length,
      players: players.map(p => ({ 
        index: p.index, 
        hand_size: p.hand.length
      }))
    });
  } catch (error) {
    console.error('Error in state:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});


app.get("/check_player/:playerId", (req, res) => {
  const { playerId } = req.params;
  const player = players.find(p => p.id === playerId);
  
  if (!player) {
    return res.status(404).json({
      status: 'error',
      message: 'Player not found'
    });
  }

  player.lastSeen = Date.now();
  res.json({
    status: 'ok',
    player_index: player.index,
    current_turn_index: currentTurnIndex
  });
});


app.post("/reset", (req, res) => {
  resetGame();
  res.json({
    status: 'ok',
    message: 'Game reset complete'
  });
});


setInterval(() => {
  const now = Date.now();
  const inactiveTimeout = 30000;
  
  const activePlayers = players.filter(player => {
    const isActive = (now - player.lastSeen) < inactiveTimeout;
    if (!isActive) {
      console.log(`Removing inactive player ${player.index}`);
    }
    return isActive;
  });

  if (activePlayers.length !== players.length) {
    console.log(`Cleaned up ${players.length - activePlayers.length} inactive players`);
    players = activePlayers;
    if (players.length === 0) {
      resetGame();
    }
  }
}, 30000);

http.createServer(app).listen(3000, () => {
  console.log("Server 12running on http://localhost:3000");
}); 