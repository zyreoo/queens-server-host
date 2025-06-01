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

const MAX_PLAYERS = 2;
const rooms = {};

function createRoom() {
  const roomId = uuidv4();
  rooms[roomId] = {
    players: [],
    deck: [],
    centerCard: null,
    currentTurnIndex: 0,
    reactionMode: false,
    reactionValue: null,
    reactingPlayers: [],
    queensTriggered: false,
    queensPlayerIndex: null,
    finalRoundActive: false,
    finalTurnCount: 0,
    initialSelectionMode: true,
    lastActivity: Date.now()
  };
  createDeck(roomId);
  return roomId;
}

function shuffleDeck(deck){
  for (let i = deck.length -1; i > 0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function createDeck(roomId) {
  const room = rooms[roomId];
  room.deck = [];
  for (let suit of suits){
    for (let rank of ranks){
      room.deck.push({ suit, rank, value: values[rank], card_id: `${suit}_${rank}_${Date.now()}`, is_face_up: false });
    }
  }
  shuffleDeck(room.deck);
}

function resetGame(roomId) {
  const room = rooms[roomId];
  room.players = [];
  createDeck(roomId);
  room.centerCard = null;
  room.currentTurnIndex = 0;
  room.reactionMode = false;
  room.reactionValue = null;
  room.reactingPlayers = [];
  room.queensTriggered = false;
  room.queensPlayerIndex = null;
  room.finalRoundActive = false;
  room.finalTurnCount = 0;
  console.log("game state reset for room:", roomId);
}

function drawHand(roomId) {
  return rooms[roomId].deck.splice(0, 4);
}

function getCenterCard(roomId) {
  const room = rooms[roomId];
  if (!room.centerCard && room.deck.length > 0) {
    room.centerCard = room.deck.pop();
    console.log("Center card set to:", room.centerCard);
  }
  return room.centerCard;
}

function nextTurn(roomId) {
  const room = rooms[roomId];
  if (room.finalRoundActive) {
    room.finalTurnCount++;
    if (room.finalTurnCount >= room.players.length) {
      const result = calculateFinalScore(roomId);
      return { game_over: true, ...result };
    }
  }
  const nextPlayerIndex = (room.currentTurnIndex + 1) % room.players.length;
  const nextPlayer = room.players[nextPlayerIndex];
  
  if (!room.finalRoundActive || nextPlayerIndex !== room.queensPlayerIndex) {
    if (room.deck.length > 0) {
      const drawnCard = room.deck.pop();
      nextPlayer.hand.push(drawnCard);
    }
  }

  room.currentTurnIndex = nextPlayerIndex;
  console.log(`Turn changed to player ${room.currentTurnIndex} in room ${roomId}`);
  
  if (room.finalRoundActive && room.currentTurnIndex === room.queensPlayerIndex) {
      const result = calculateFinalScore(roomId);
      return { game_over: true, ...result };
  }

  return { game_over: false };
}

function calculateFinalScore(roomId) {
  const room = rooms[roomId];
  let scores = [];
  let totalOtherScores = 0;
  let lowestScore = Infinity;
  let queensScore = 0;

  room.players.forEach((player, i) => {
    let handScore = 0;
    player.hand.forEach(card => {
      if (card.rank === "12") handScore += 0;
      else if (card.rank === "1") handScore += 1;
      else if (["11", "13"].includes(card.rank)) handScore += 10;
      else handScore += parseInt(card.rank);
    });
    scores.push(handScore);
    if (i === room.queensPlayerIndex) queensScore = handScore;
    else totalOtherScores += handScore;
    if (handScore < lowestScore) lowestScore = handScore;
  });

  if (queensScore === lowestScore) {
    return { winner: room.queensPlayerIndex, message: `player ${room.queensPlayerIndex + 1} wins!` };
  } else {
    room.players[room.queensPlayerIndex].score = totalOtherScores;
    room.players.forEach((p, i) => { if (i !== room.queensPlayerIndex) p.score = 0; });
    return { winner: null, message: `player ${room.queensPlayerIndex + 1} called queens but didn't have the lowest score. They get ${totalOtherScores} points.` };
  }
}

app.post("/create_room", (req, res) => {
  try {
    const roomId = createRoom();
    rooms[roomId].lastActivity = Date.now();
    res.json({
      status: "ok",
      room_id: roomId
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/join", (req, res) => {
  try {
    const { room_id, player_id } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    
    if (player_id) {
      const existing = room.players.find(p => p.id === player_id);
      if (existing) {
        return res.json({
          status: "ok",
          room_id: room_id,
          player_id: existing.id,
          player_index: existing.index,
          hand: existing.hand,
          center_card: getCenterCard(room_id),
          current_turn_index: room.currentTurnIndex,
          total_players: room.players.length
        });
      }
    }

    if (room.players.length >= MAX_PLAYERS) {
      return res.status(400).json({
        status: 'error',
        message: 'Game is full'
      });
    }

    const playerID = uuidv4(); 
    const newPlayer = {
      id: playerID,
      hand: drawHand(room_id), 
      index: room.players.length,
      lastSeen: Date.now(),
      score: 0,
      initialSelectionComplete: false
    };

    room.players.push(newPlayer);
    room.lastActivity = Date.now();
    console.log(`player ${newPlayer.index} joined room ${room_id}, total players: ${room.players.length}`);

    if (room.players.length === MAX_PLAYERS) {
      room.initialSelectionMode = true;
      console.log(`Room ${room_id} is full, entering initial selection mode.`);
    }

    res.json({
      status: 'ok',
      room_id: room_id,
      player_id: playerID,
      player_index: newPlayer.index,
      hand: newPlayer.hand,
      center_card: getCenterCard(room_id),
      current_turn_index: room.currentTurnIndex,
      total_players: room.players.length,
      initial_selection_mode: room.initialSelectionMode
    });

  } catch (error) {
    console.error('Error in join:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/play_card", (req, res) => {
  try {
    const { room_id, player_index, card_id } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];

    if (player_index !== room.currentTurnIndex && !room.reactionMode) {
      return res.status(403).json({
        status: "error",
        message: `not ur turn. Current turn: ${room.currentTurnIndex}, ur index: ${player_index}`
      });
    }

    const player = room.players.find(p => p.index === player_index);

    if (!player) {
      return res.status(404).json({
        status: "error",
        message: "Player not found"
      });
    }

    const cardIndex = player.hand.findIndex(c => c.card_id === card_id);
    if (cardIndex === -1) {
      return res.status(400).json({ status: "error", message: "Card not in hand" });
    }

    if (room.reactionMode && player.hand[cardIndex].value !== room.reactionValue) {
      if (!room.reactingPlayers.includes(player_index)) {
        room.reactingPlayers.push(player_index);
        if (room.deck.length > 0) {
            const penaltyCard = room.deck.pop();
            player.hand.push(penaltyCard);
            console.log(`Player ${player_index} received a penalty card.`);
        }
        return res.json({
          status: "ok",
          hand: player.hand,
          message: "Invalid card, penalty card added",
          center_card: room.centerCard,
          current_turn_index: room.currentTurnIndex,
          total_players: room.players.length
        });
      }
    }

    const playedCardData = { ...player.hand[cardIndex] };

    player.hand.splice(cardIndex, 1);
    
    room.centerCard = null;
    room.lastActivity = Date.now();

    let response = { 
      status: "ok", 
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      total_players: room.players.length,
    };

    if (playedCardData.rank === "13") {
      response.center_card = playedCardData;
      response.king_reveal_mode = true;
      response.king_player_index = player_index;
      response.message = "King played! Choose one of your cards to reveal.";
    } else if (playedCardData.rank === "11") {
      response.center_card = playedCardData;
      response.jack_swap_mode = true;
      response.jack_player_index = player_index;
      response.message = "Jack played! Select a card to swap.";
      response.hand = player.hand;
      return res.json(response);
    } else if (playedCardData.rank === "12") {
      const nextPlayerIndex = (player_index + 1) % room.players.length;
      const nextPlayer = room.players[nextPlayerIndex];
      nextPlayer.hand.push(playedCardData);
      response.center_card = null;
      response.message = "Queen played! It goes to the next player's hand.";
    } else {
        response.center_card = playedCardData;
        room.reactionMode = true;
        room.reactionValue = playedCardData.value;
        room.reactingPlayers = [];
        response.reaction_mode = true;
        response.reaction_value = playedCardData.value;
        response.message = `Reaction mode active! Play a ${playedCardData.value}.`;
    }
    
    const turnResult = nextTurn(room_id);
    response.current_turn_index = room.currentTurnIndex;
    if (turnResult.game_over) {
        response = { ...response, ...turnResult };
    }

    response.hand = player.hand;

    res.json(response);

  } catch (error) {
    console.error('Error in play_card:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/jack_swap", (req, res) => {
  try {
    const { room_id, player_index, from_card_id, to_card_id } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];

    if (player_index !== room.currentTurnIndex) {
      return res.status(403).json({ status: "error", message: "Not your turn" });
    }
    
    if (room.finalRoundActive && player_index === room.queensPlayerIndex) {
        return res.status(400).json({ status: "error", message: "Cannot swap cards after calling Queens." });
    }

    const player = room.players[player_index];
    const opponent = room.players.find(p => p.index !== player_index);
    const fromCardIndex = player.hand.findIndex(c => c.card_id === from_card_id);
    const toCardIndex = opponent.hand.findIndex(c => c.card_id === to_card_id);

    if (fromCardIndex === -1 || toCardIndex === -1) {
      return res.status(400).json({ status: "error", message: "Invalid card selection" });
    }

    const temp = player.hand[fromCardIndex];
    player.hand[fromCardIndex] = opponent.hand[toCardIndex];
    opponent.hand[toCardIndex] = temp;

    nextTurn(room_id);
    res.json({
      status: "ok",
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      player_hand: player.hand,
      opponent_hand_size: opponent.hand.length
    });
  } catch (error) {
    console.error("Error in jack_swap:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

app.post("/call_queens", (req, res) => {
  try {
    const { room_id, player_index } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];

    if (player_index !== room.currentTurnIndex) {
      return res.status(403).json({ status: "error", message: "Not your turn" });
    }

    room.queensTriggered = true;
    room.queensPlayerIndex = player_index;
    room.finalRoundActive = true;
    room.finalTurnCount = 0;
    nextTurn(room_id);
    room.lastActivity = Date.now();

    res.json({
      status: "ok",
      message: "Queens called! Final round started.",
      current_turn_index: room.currentTurnIndex,
      queens_triggered: room.queensTriggered,
      queens_player_index: room.queensPlayerIndex,
      final_round_active: room.finalRoundActive
    });
  } catch (error) {
    console.error("Error in call_queens:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

app.post("/select_initial_cards", (req, res) => {
  try {
    const { room_id, player_index, selected_card_ids } = req.body;

    if (!rooms[room_id]) {
      return res.status(404).json({ status: 'error', message: 'Room not found' });
    }

    const room = rooms[room_id];
    const player = room.players[player_index];

    if (!room.initialSelectionMode) {
      return res.status(400).json({ status: 'error', message: 'Not in initial selection mode.' });
    }

    if (player.initialSelectionComplete) {
      return res.status(400).json({ status: 'error', message: 'Initial selection already complete.' });
    }

    if (!selected_card_ids || selected_card_ids.length !== 2) {
      return res.status(400).json({ status: 'error', message: 'Must select exactly 2 cards.' });
    }

    player.hand.forEach(card => {
      if (selected_card_ids.includes(card.card_id)) {
        card.is_face_up = true;
        card.permanent_face_up = true;
      }
    });

    player.initialSelectionComplete = true;
    console.log(`Player ${player_index} in room ${room_id} completed initial selection.`);

    const allSelected = room.players.every(p => p.initialSelectionComplete);

    if (allSelected) {
      room.initialSelectionMode = false;

      room.players.forEach(p => {
        while (p.hand.length < 4) {
          if (room.deck.length > 0) {
            p.hand.push(room.deck.pop());
          } else {
            console.warn("Deck is empty, cannot deal full initial hands.");
            break;
          }
        }
      });

      getCenterCard(room_id);
      console.log(`All players in room ${room_id} completed initial selection. Starting game.`);

      room.currentTurnIndex = 0;

      res.json({
        status: 'ok',
        message: 'Initial selection complete. Game starting.',
        initial_selection_mode: false,
        current_turn_index: room.currentTurnIndex,
        players: room.players.map(p => ({
          index: p.index,
          hand: p.hand
        }))
      });
    } else {
      res.json({
        status: 'ok',
        message: 'Selection received. Waiting for other players.',
        players: room.players.map(p => ({
          index: p.index,
          hand: p.hand
        }))
      });
    }

  } catch (error) {
    console.error('Error in select_initial_cards:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get("/state", (req, res) => {
  try {
    const { room_id } = req.query;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    
    res.json({
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      deck_count: room.deck.length,
      total_players: room.players.length,
      players: room.players.map(p => ({ 
        index: p.index, 
        hand_size: p.hand.length,
        hand: p.hand
      })),
      reaction_mode: room.reactionMode,
      reaction_value: room.reactionValue,
      queens_triggered: room.queensTriggered,
      final_round_active: room.finalRoundActive,
      initial_selection_mode: room.initialSelectionMode
    });
    console.log("State sent to client for room", room_id, "- center card:", room.centerCard, "turn index:", room.currentTurnIndex);
  } catch (error) {
    console.error('Error in state:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

app.post("/reset", (req, res) => {
  const { room_id } = req.body;
  
  if (!rooms[room_id]) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found'
    });
  }

  resetGame(room_id);
  res.json({
    status: 'ok',
    message: 'Game reset complete'
  });
});

app.get("/rooms", (req, res) => {
  try {
    const roomList = Object.entries(rooms).map(([id, room]) => ({
      room_id: id,
      player_count: room.players.length,
      max_players: MAX_PLAYERS
    }));
    
    res.json({
      status: 'ok',
      rooms: roomList
    });
  } catch (error) {
    console.error('Error listing rooms:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/king_reveal', (req, res) => {
  try {
    const { room_id, player_index, revealed_card_id } = req.body;
    console.log(`Received /king_reveal request for room ${room_id}, player ${player_index}, card ${revealed_card_id}`);

    const room = rooms[room_id];
    if (!room) {
      return res.status(404).json({ status: 'error', message: 'Room not found.' });
    }

    const player = room.players[player_index];
    if (!player) {
       return res.status(404).json({ status: 'error', message: 'Player not found.' });
    }

    let cardFound = false;
    for (const card of player.hand) {
      if (card.card_id === revealed_card_id) {
        card.is_face_up = true;
        cardFound = true;
        console.log(`Server: Revealed card ${revealed_card_id} for player ${player_index}`);
        break;
      }
    }

    if (!cardFound) {
      return res.status(404).json({ status: 'error', message: 'Revealed card not found in player' });
    }

    room.king_reveal_mode = false;
    room.king_player_index = -1;

    const playersData = room.players.map(p => ({
        index: p.index,
        hand_size: p.hand.length,
        hand: p.hand.map(card => ({
            ...card,
            is_face_up: card.is_face_up
        })),
    }));

    const response = {
      status: "ok",
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      total_players: room.players.length,
      players: playersData,
      king_reveal_mode: room.king_reveal_mode,
      king_player_index: room.king_player_index,
      message: `Player ${player_index + 1} revealed a card.`,
      reaction_mode: room.reactionMode,
      reaction_value: room.reactionValue,
      jack_swap_mode: room.jack_swap_mode,
      jack_player_index: room.jack_player_index,
      queens_triggered: room.queensTriggered,
      final_round_active: room.finalRoundActive,
    };

    res.json(response);

  } catch (error) {
    console.error('Error in king_reveal:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
});

function checkInactiveRooms() {
  const now = Date.now();
  const inactivityTimeout = 2 * 60 * 1000;
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (now - room.lastActivity > inactivityTimeout) {
      console.log(`Room ${roomId} is inactive, ending game and closing room.`);
      const winningPlayerIndex = (room.currentTurnIndex + 1) % room.players.length;
      const winnerMessage = `Game ended due to inactivity. Player ${winningPlayerIndex + 1} wins.`;
      
      delete rooms[roomId];
      console.log(`Room ${roomId} closed.`);
    }
  }
}
setInterval(checkInactiveRooms, 30 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 