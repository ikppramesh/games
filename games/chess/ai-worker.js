/* Runs the computer's search off the main thread so the board keeps
   animating while it thinks. Message in: {id, fen, level}; out: {id, move}. */
importScripts('engine.js');
self.onmessage = (e) => {
  const { id, fen, level } = e.data;
  const move = self.ChessEngine.bestMove(fen, level);
  self.postMessage({ id, move });
};
