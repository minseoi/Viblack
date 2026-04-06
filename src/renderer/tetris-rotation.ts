export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export type Rotation = 0 | 1 | 2 | 3;

export interface PieceState {
  kind: PieceType;
  x: number;
  y: number;
  rotation: Rotation;
}

export type RotationDirection = "cw" | "ccw";

export type Board = ReadonlyArray<ReadonlyArray<number>>;

export interface RotationResult {
  state: PieceState;
  rotated: boolean;
}

type Offset = readonly [number, number];

const PIECE_CELLS: Readonly<Record<PieceType, ReadonlyArray<Offset>>> = {
  I: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  O: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  T: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  S: [
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
  ],
  Z: [
    [-1, 0],
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  J: [
    [-1, 0],
    [-1, 1],
    [0, 0],
    [1, 0],
  ],
  L: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [1, 1],
  ],
};

const WALL_KICK_CANDIDATES: ReadonlyArray<Offset> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [1, -1],
  [-1, -1],
];

function rotateOffsetCW([x, y]: readonly [number, number]): Offset {
  return [y, -x];
}

function normalizeRotation(rotation: number): Rotation {
  return (((rotation % 4) + 4) % 4) as Rotation;
}

export function getPieceCells(state: Readonly<PieceState>): Array<[number, number]> {
  const base = PIECE_CELLS[state.kind];
  const cells: Array<[number, number]> = [];
  for (const cell of base) {
    let [x, y] = cell;
    const steps = state.rotation;
    for (let i = 0; i < steps; i++) {
      [x, y] = rotateOffsetCW([x, y]);
    }
    cells.push([state.x + x, state.y + y]);
  }
  return cells;
}

export function canPlacePiece(board: Board, state: Readonly<PieceState>): boolean {
  const height = board.length;
  const width = board[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    return false;
  }

  for (const [x, y] of getPieceCells(state)) {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return false;
    }
    if (board[y]?.[x] !== 0) {
      return false;
    }
  }
  return true;
}

export function applyRotation(
  board: Board,
  state: Readonly<PieceState>,
  direction: RotationDirection,
): RotationResult {
  const next = tryRotatePiece(board, state, direction);
  return {
    state: next,
    rotated: next.rotation !== state.rotation || next.x !== state.x || next.y !== state.y,
  };
}

export function tryRotatePiece(
  board: Board,
  state: Readonly<PieceState>,
  direction: RotationDirection,
): PieceState {
  const nextRotation =
    direction === "cw"
      ? normalizeRotation(state.rotation + 1)
      : normalizeRotation(state.rotation + 3);

  const rotated: PieceState = {
    ...state,
    rotation: nextRotation,
  };

  for (const [dx, dy] of WALL_KICK_CANDIDATES) {
    const candidate: PieceState = {
      ...rotated,
      x: rotated.x + dx,
      y: rotated.y + dy,
    };
    if (canPlacePiece(board, candidate)) {
      return candidate;
    }
  }

  return {
    ...state,
  };
}
