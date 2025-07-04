"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import SaveDeckButton from "./save-deck";

// --- 型定義 ---
type Contribution = {
  Date: string;
  ContributionCount: number;
};

// ★★★ APIに送信するテトリミノの型定義
type TetrominoPlacementPayload = {
  type: string;
  rotation: number;
  startDate: string;
  positions: { x: number; y: number; score: number }[];
  scorePotential: number;
};

// --- カラーコード定義 ---
const UI_COLORS = {
  brightGreen: "#56D364",
  darkGreen: "#2DA042",
  darkBackground: "#151823",
  lightText: "#F0F5FA",
};

const TETROMINO_COLORS = {
  I: ["#5BE3B6", "#50C69E", "#43A987", "#388C70", "#2C6E58"],
  O: ["#F2E530", "#D5CA2B", "#B8AE24", "#989320", "#7E7719"],
  T: ["#F28707", "#D57706", "#B86706", "#985706", "#7E4606"],
  S: ["#6EF230", "#61D52B", "#53B824", "#469B20", "#397E19"], // GitHub草の基本色として利用
  Z: ["#F23064", "#D52858", "#B8244C", "#9B2040", "#7E1934"],
  J: ["#0066FF", "#005AE2", "#0050C5", "#0043A8", "#00378A"],
  L: ["#B963F2", "#A357D5", "#8D4BB8", "#763F9B", "#60347E"],
};

// --- テトリミノの形状定義 (相対座標) ---
const TETROMINO_SHAPES = {
  I: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  J: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  L: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  O: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  S: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  T: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  Z: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
};

const TETROMINO_PIVOTS = {
  I: [1.5, 0.5],
  J: [1, 1],
  L: [1, 1],
  O: [0.5, 0.5],
  S: [1, 1],
  T: [1, 1],
  Z: [1, 1],
};

// --- グリッド設定 ---
const GRID_WIDTH = 8;
const GRID_HEIGHT = 7;
const CELL_PX_SIZE = 36;

// --- ヘルパー関数 ---

/**
 * ContributionCountからコントリビューションレベル(0-4)を決定します。
 * @param {number} count ContributionCount
 * @returns {number} レベル (0-4)
 */
const getContributionLevel = (count: number) => {
  if (count > 20) return 5;
  if (count > 10) return 4;
  if (count > 5) return 3;
  if (count > 0) return 2;
  if (count >= 0) return 1;
  return 0;
};

/**
 * 貢献度レベルからスコアを計算します。
 * @param {number} level 貢献度レベル (0-4)
 * @returns {number} 計算されたスコア
 */
const getScoreFromContributionLevel = (level) => {
  return level * 100;
};

/**
 * 貢献度レベルからGitHub草の色を取得します。
 * @param {number} level 貢献度レベル (0-4)
 * @returns {string} 対応するHEXカラーコード
 */
const getGrassColorFromLevel = (level) => {
  if (level === 0) return UI_COLORS.darkBackground;
  // Sミノ（緑系）のカラーパレットを使用。レベル1からインデックス0に対応させる
  return TETROMINO_COLORS["S"][level - 1] || UI_COLORS.darkBackground;
};

/**
 * テトリミノの回転を行います。
 * @param {Array<Array<number>>} shape 形状の相対座標
 * @param {Array<number>} pivot 回転軸
 * @param {number} angle 回転角度 (90の倍数)
 * @returns {Array<Array<number>>} 回転後の座標
 */
const rotateShape = (shape, pivot, angle) => {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const [px, py] = pivot;

  return shape.map(([x, y]) => {
    // 回転軸を原点に移動 -> 回転 -> 回転軸を元に戻す
    const translatedX = x - px;
    const translatedY = y - py;
    const rotatedX = translatedX * cos - translatedY * sin;
    const rotatedY = translatedX * sin + translatedY * cos;
    return [Math.round(rotatedX + px), Math.round(rotatedY + py)];
  });
};

/**
 * 衝突判定を行います。
 * @param {Array<Array<number>>} cellsToCheck チェックするセルの絶対座標
 * @param {Object} currentTetromino 現在のテトリミノ
 * @param {Array<Object>} placedTetrominos 配置済みのテトリミノ
 * @returns {boolean} 衝突があればtrue
 */
const checkCollision = (cellsToCheck, currentTetromino, placedTetrominos) => {
  for (const [x, y] of cellsToCheck) {
    // 1. グリッドの境界チェック
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
      return true; // グリッド外にはみ出し
    }

    // 2. 他の配置済みテトリミノとの重なりチェック
    for (const placed of placedTetrominos) {
      // 自身は衝突判定から除外
      if (currentTetromino && placed.id === currentTetromino.id) continue;

      // 配置済みテトリミノの各ブロックと重なっているか確認
      if (placed.absolutePositions.some(([px, py]) => x === px && y === py))
        return true; // 重なりあり
    }
  }
  return false; // 衝突なし
};

// --- React コンポーネント ---

// --- React コンポーネント ---
export default function DeckMain() {
  const [contributionGrid, setContributionGrid] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placedTetrominos, setPlacedTetrominos] = useState<any[]>([]);
  const [selectedTetrominoType, setSelectedTetrominoType] = useState<
    string | null
  >(null);
  const [potentialScore, setPotentialScore] = useState(0);
  const [draggedTetrominoId, setDraggedTetrominoId] = useState<number | null>(
    null
  );
  const [message, setMessage] = useState("");
  const [isDraggingNew, setIsDraggingNew] = useState(false); // パレットからの新規ドラッグか
  const gridRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  /**
   * １次元のContribution配列を7x8の2Dグリッドに変換します。
   * @param {Array<Contribution>} contributions APIから取得した貢献データ
   * @returns {Array<Array<object>>} 7x8のグリッドデータ
   */
  const transformContributionsToGrid = (contributions) => {
    const grid = Array(GRID_HEIGHT)
      .fill(0)
      .map(() => Array(GRID_WIDTH).fill({ count: 0, level: 0 }));
    // 56日分のデータをグリッドにマッピング
    const totalCells = GRID_WIDTH * GRID_HEIGHT;
    for (let i = 0; i < totalCells; i++) {
      const contribution = contributions?.[i];
      const x = Math.floor(i / GRID_HEIGHT);
      const y = i % GRID_HEIGHT;
      if (contribution && y < GRID_HEIGHT && x < GRID_WIDTH) {
        const count = contribution.count; // ←修正
        const level = getContributionLevel(count);
        grid[y][x] = { count, level, date: contribution.date };
      }
    }
    return grid;
  };

  // 貢献データを取得する関数
  const fetchContributions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("ユーザーが認証されていません");
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
      const response = await fetch(`${apiUrl}/api/contributions/${user.id}`);

      if (!response.ok) throw new Error(`APIエラー`);

      const data = await response.json();
      console.log("APIから取得したコントリビューションデータ:", data); // ←追加
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("コントリビューションデータが取得できませんでした");
      }
      setContributionGrid(transformContributionsToGrid(data));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContributions();
  }, [fetchContributions]);

  // 絶対座標とスコア、色インデックスを計算するヘルパー
  const calculateTetrominoDetails = useCallback(
    (type, currentX, currentY, currentRotation) => {
      if (!type)
        return { absolutePositions: [], scorePotential: 0, blockDetails: [] };
      const relativeShape = rotateShape(
        TETROMINO_SHAPES[type],
        TETROMINO_PIVOTS[type],
        currentRotation
      );
      const absolutePositions = relativeShape.map(([rx, ry]) => [
        currentX + rx,
        currentY + ry,
      ]);

      let scorePotential = 0;
      const blockDetails = []; // [{x, y, level, score, colorIndex}]

      absolutePositions.forEach(([ax, ay]) => {
        let level = 0;
        if (
          ay >= 0 &&
          ay < GRID_HEIGHT &&
          ax >= 0 &&
          ax < GRID_WIDTH &&
          contributionGrid.length > 0 &&
          contributionGrid[ay] &&
          contributionGrid[ay][ax]
        ) {
          level = contributionGrid[ay][ax].level;
        }
        const score = getScoreFromContributionLevel(level);
        scorePotential += score;
        // @ts-ignore
        blockDetails.push({
          x: ax,
          y: ay,
          level,
          score,
          colorIndex: level > 0 ? level - 1 : -1,
        });
      });
      return { absolutePositions, scorePotential, blockDetails };
    },
    [contributionGrid]
  );

  // FIX: Recalculates total score whenever placedTetrominos array is modified. This is the single source of truth for the score.
  useEffect(() => {
    const newScore = placedTetrominos.reduce(
      (sum, piece) => sum + (piece.scorePotential || 0),
      0
    );
    setPotentialScore(newScore);
  }, [placedTetrominos]);

  // FIX: Recalculates individual tetromino scores ONLY when the underlying contribution grid changes.
  useEffect(() => {
    if (
      !loading &&
      contributionGrid.length > 0 &&
      placedTetrominos.length > 0
    ) {
      setPlacedTetrominos((currentTetrominos) =>
        currentTetrominos.map((t) => {
          const { scorePotential, blockDetails, absolutePositions } =
            calculateTetrominoDetails(t.type, t.x, t.y, t.rotation);
          // Return a new object with the updated score and details
          return { ...t, scorePotential, blockDetails, absolutePositions };
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, contributionGrid]);

  // FIX: A more robust function to adjust drop position, handling all four boundaries.
  const getAdjustedDropPosition = useCallback(
    (type, rotation, dropX, dropY) => {
      const relativeShape = rotateShape(
        TETROMINO_SHAPES[type],
        TETROMINO_PIVOTS[type],
        rotation
      );

      // Calculate bounding box of the relative shape
      const minX = Math.min(...relativeShape.map((p) => p[0]));
      const maxX = Math.max(...relativeShape.map((p) => p[0]));
      const minY = Math.min(...relativeShape.map((p) => p[1]));
      const maxY = Math.max(...relativeShape.map((p) => p[1]));

      let adjustedX = dropX;
      let adjustedY = dropY;

      // Check how much the piece is out of bounds
      const leftOverflow = -(adjustedX + minX);
      const rightOverflow = adjustedX + maxX - (GRID_WIDTH - 1);
      const topOverflow = -(adjustedY + minY);
      const bottomOverflow = adjustedY + maxY - (GRID_HEIGHT - 1);

      // Apply adjustments
      if (leftOverflow > 0) {
        adjustedX += leftOverflow;
      }
      if (rightOverflow > 0) {
        adjustedX -= rightOverflow;
      }
      if (topOverflow > 0) {
        adjustedY += topOverflow;
      }
      if (bottomOverflow > 0) {
        adjustedY -= bottomOverflow;
      }

      return { adjustedX, adjustedY };
    },
    []
  );

  // --- ドラッグ＆ドロップ、回転、削除のハンドラ ---
  const handlePaletteDragStart = (e, type) => {
    setSelectedTetrominoType(type);
    setDraggedTetrominoId(null);
    setIsDraggingNew(true);
    e.dataTransfer.setData("text/plain", type);
  };

  const handlePlacedTetrominoDragStart = (e, id) => {
    setDraggedTetrominoId(id);
    setIsDraggingNew(false);
    setSelectedTetrominoType(
      placedTetrominos.find((t) => t.id === id)?.type || null
    );
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      if (!gridRef.current) return;
      const gridRect = gridRef.current.getBoundingClientRect();

      if (gridRect.width === 0 || gridRect.height === 0) {
        setMessage("グリッドの読み込みに問題が発生しました。");
        console.error("Grid has no dimensions, cannot process drop.");
        return;
      }

      const mouseX = e.clientX - gridRect.left;
      const mouseY = e.clientY - gridRect.top;

      const cellWidth = gridRect.width / GRID_WIDTH;
      const cellHeight = gridRect.height / GRID_HEIGHT;

      if (cellWidth <= 0 || cellHeight <= 0) {
        setMessage("グリッドのセルサイズを計算できません。");
        console.error("Cell dimensions are invalid.");
        return;
      }

      const dropGridX = Math.floor(mouseX / cellWidth);
      const dropGridY = Math.floor(mouseY / cellHeight);

      if (!isFinite(dropGridX) || !isFinite(dropGridY)) {
        console.error("Calculated drop coordinates are not finite.", {
          dropGridX,
          dropGridY,
        });
        setMessage("ドロップ位置の計算に失敗しました。");
        return;
      }

      const handlePlacement = (
        type,
        rotation,
        baseDropX,
        baseDropY,
        id = null
      ) => {
        // FIX: Adjust drop position based on pivot to make it feel more centered.
        const pivot = TETROMINO_PIVOTS[type];
        const centeredDropX = baseDropX - Math.floor(pivot[0]);
        const centeredDropY = baseDropY - Math.floor(pivot[1]);

        const { adjustedX, adjustedY } = getAdjustedDropPosition(
          type,
          rotation,
          centeredDropX,
          centeredDropY
        );

        const details = calculateTetrominoDetails(
          type,
          adjustedX,
          adjustedY,
          rotation
        );

        if (
          checkCollision(
            details.absolutePositions,
            { id, absolutePositions: details.absolutePositions },
            placedTetrominos
          )
        ) {
          setMessage("その場所には配置できません。");
          return null;
        }
        return {
          id: id || Date.now(),
          type,
          x: adjustedX,
          y: adjustedY,
          rotation,
          ...details,
        };
      };

      if (isDraggingNew && selectedTetrominoType) {
        const newPiece = handlePlacement(
          selectedTetrominoType,
          0,
          dropGridX,
          dropGridY
        );
        if (newPiece) {
          setPlacedTetrominos((prev) => [...prev, newPiece]);
          setMessage("テトリミノを配置しました！");
          setSelectedTetrominoType(null);
        }
      } else if (draggedTetrominoId !== null) {
        const tetrominoToMove = placedTetrominos.find(
          (t) => t.id === draggedTetrominoId
        );
        if (tetrominoToMove) {
          // @ts-ignore
          const movedPiece = handlePlacement(
            tetrominoToMove.type,
            tetrominoToMove.rotation,
            dropGridX,
            dropGridY,
            draggedTetrominoId
          );
          if (movedPiece) {
            setPlacedTetrominos((prev) =>
              prev.map((p) => (p.id === draggedTetrominoId ? movedPiece : p))
            );
            setMessage("テトリミノを移動しました！");
          }
        }
        setDraggedTetrominoId(null);
      }
    },
    [
      isDraggingNew,
      selectedTetrominoType,
      placedTetrominos,
      draggedTetrominoId,
      calculateTetrominoDetails,
      getAdjustedDropPosition,
    ]
  );

  const handleRotate = useCallback(
    (id) => {
      setPlacedTetrominos((prev) => {
        const tetrominoIndex = prev.findIndex((t) => t.id === id);
        if (tetrominoIndex === -1) return prev;

        const tetromino = prev[tetrominoIndex];
        const { type, x, y, rotation } = tetromino;
        const newRotation = (rotation + 90) % 360;

        // FIX: Implement a "wall kick" logic to test for valid rotation positions.
        const kickTranslations = [
          [0, 0],
          [-1, 0],
          [1, 0],
          [-2, 0],
          [2, 0],
        ]; // [dx, dy]

        for (const [dx, dy] of kickTranslations) {
          const testX = x + dx;
          const testY = y + dy;

          // Adjust final position to ensure it's within bounds after kicking
          const { adjustedX, adjustedY } = getAdjustedDropPosition(
            type,
            newRotation,
            testX,
            testY
          );

          const details = calculateTetrominoDetails(
            type,
            adjustedX,
            adjustedY,
            newRotation
          );
          const tempTetromino = {
            ...tetromino,
            absolutePositions: details.absolutePositions,
          };

          if (!checkCollision(details.absolutePositions, tempTetromino, prev)) {
            const newPlacedTetrominos = [...prev];
            newPlacedTetrominos[tetrominoIndex] = {
              ...tetromino,
              rotation: newRotation,
              x: adjustedX,
              y: adjustedY,
              ...details,
            };
            setMessage("テトリミノを回転しました！");
            return newPlacedTetrominos;
          }
        }

        setMessage("その向きには回転できません。");
        return prev; // Return original state if no valid rotation is found
      });
    },
    [calculateTetrominoDetails, getAdjustedDropPosition]
  );

  const handleDelete = useCallback((id) => {
    setPlacedTetrominos((prev) => prev.filter((t) => t.id !== id));
    setMessage("テトリミノを削除しました。");
  }, []);

  const handleDragOver = (e) => e.preventDefault();

  const onSaveSuccess = () => {
    setMessage("デッキが正常に保存されました！ 2秒後に移動します...");

    // 2秒待ってから指定したページに遷移させる
    setTimeout(() => {
      // あなたが遷移させたいページのパス（例: /homepage, /dashboard など）
      router.push("/homepage");
    }, 2000);
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{
        backgroundColor: UI_COLORS.darkBackground,
        fontFamily: '"DotGothic16", monospace',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DotGothic16&display=swap');`}</style>
      <h1
        className="text-4xl font-bold mb-8"
        style={{ color: UI_COLORS.lightText }}
      >
        GitHub 草テトリス：デッキ編成
      </h1>

      <div className="bg-gray-800 p-6 rounded-xl shadow-lg mb-8 w-full max-w-4xl flex justify-between items-start flex-wrap">
        {/* テトリミノパレット */}
        <div className="w-full md:w-1/4 mb-6 md:mb-0">
          <h2
            className="text-2xl font-semibold mb-4"
            style={{ color: UI_COLORS.lightText }}
          >
            テトリミノパレット
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {Object.keys(TETROMINO_SHAPES).map((type) => {
              const isPlaced = placedTetrominos.some((p) => p.type === type);
              return (
                <div
                  key={type}
                  className={`p-3 bg-gray-700 rounded-lg flex flex-col items-center justify-center transition-all ${
                    isPlaced
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-grab hover:scale-105"
                  }`}
                  draggable={!isPlaced}
                  onDragStart={(e) => handlePaletteDragStart(e, type)}
                >
                  <div
                    className="grid gap-px"
                    style={{ gridTemplateColumns: `repeat(4, 12px)` }}
                  >
                    {Array.from({ length: 4 }).map((_, r) =>
                      Array.from({ length: 4 }).map((__, c) => (
                        <div
                          key={`${type}-${r}-${c}`}
                          className="w-3 h-3 rounded-sm"
                          style={{
                            backgroundColor: "transparent",
                            border: TETROMINO_SHAPES[
                              type as keyof typeof TETROMINO_SHAPES
                            ].some(([x, y]) => x === c && y === r)
                              ? `1px solid ${
                                  TETROMINO_COLORS[
                                    type as keyof typeof TETROMINO_COLORS
                                  ][0]
                                }`
                              : "none",
                          }}
                        ></div>
                      ))
                    )}
                  </div>
                  <span
                    className="text-sm mt-2 font-bold"
                    style={{ color: UI_COLORS.lightText }}
                  >
                    {type}-ミノ
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {/* グリッドとスコア表示 */}
        <div className="w-full md:w-3/4 flex flex-col items-center">
          <div className="w-full flex justify-between items-center mb-4">
            <h2
              className="text-2xl font-semibold"
              style={{ color: UI_COLORS.lightText }}
            >
              GitHub草グリッド (8x7)
            </h2>
            <button
              onClick={fetchContributions}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-500"
            >
              {loading ? "取得中..." : "データ再取得"}
            </button>
          </div>

          {/* メッセージボックス */}
          {message && (
            <div className="bg-blue-500 text-white px-4 py-2 rounded-lg mb-4 text-center">
              {message}
            </div>
          )}
          {error && (
            <div className="bg-red-500 text-white px-4 py-2 rounded-lg mb-4 text-center">
              エラー: {error}
            </div>
          )}

          {/* ポテンシャルスコア */}
          <div
            className="text-4xl font-bold mb-6 p-4 rounded-xl"
            style={{
              backgroundColor: UI_COLORS.darkGreen,
              color: UI_COLORS.lightText,
              boxShadow: "0 0 15px rgba(86, 211, 100, 0.5)",
            }}
          >
            ポテンシャルスコア:{" "}
            <span style={{ color: UI_COLORS.brightGreen }}>
              {potentialScore}
            </span>
          </div>
          <div className="mb-4">
            <SaveDeckButton
              tetrominosToSave={placedTetrominos.map((t) => {
                const startDate =
                  contributionGrid[t.y]?.[t.x]?.date ||
                  new Date().toISOString().split("T")[0];
                const positions = t.blockDetails.map((block: any) => ({
                  x: block.x,
                  y: block.y,
                  score: block.score,
                }));
                const payload: TetrominoPlacementPayload = {
                  type: t.type,
                  rotation: t.rotation,
                  startDate,
                  positions,
                  scorePotential: t.scorePotential,
                };
                return payload;
              })}
              onSaveSuccess={onSaveSuccess}
            />
          </div>

          {/* メイングリッド */}
          <div
            ref={gridRef}
            className="relative grid rounded-lg shadow-inner bg-black"
            style={{
              gridTemplateColumns: `repeat(${GRID_WIDTH}, ${CELL_PX_SIZE}px)`,
              gridTemplateRows: `repeat(${GRID_HEIGHT}, ${CELL_PX_SIZE}px)`,
            }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-opacity-50 bg-gray-900 z-50">
                <p className="text-white text-2xl">Loading...</p>
              </div>
            ) : (
              contributionGrid.length > 0 &&
              Array.from({ length: GRID_HEIGHT }).map((_, y) =>
                Array.from({ length: GRID_WIDTH }).map((__, x) => {
                  const level = contributionGrid[y]?.[x]?.level ?? 0;
                  return (
                    <div
                      key={`${x}-${y}`}
                      className="w-9 h-9 rounded-sm box-border"
                      style={{
                        backgroundColor: getGrassColorFromLevel(level),
                        border: `1px solid ${UI_COLORS.darkBackground}`,
                      }}
                    />
                  );
                })
              )
            )}

            {/* 配置されたテトリミノを絶対位置でレンダリング */}
            {placedTetrominos.map((tetrimino) => {
              const pos = tetrimino?.absolutePositions;
              if (!pos || pos.length === 0) return null;
              const xs = pos.map((p: number[]) => p[0]);
              const ys = pos.map((p: number[]) => p[1]);
              if (xs.some((v) => !isFinite(v)) || ys.some((v) => !isFinite(v)))
                return null;

              // テトリミノのバウンディングボックスの最小/最大座標を計算
              const minX = Math.min(...xs);
              const minY = Math.min(...ys);
              const widthPx = (Math.max(...xs) - minX + 1) * CELL_PX_SIZE;
              const heightPx = (Math.max(...ys) - minY + 1) * CELL_PX_SIZE;
              const leftPx = minX * CELL_PX_SIZE;
              const topPx = minY * CELL_PX_SIZE;
              if (
                !isFinite(leftPx) ||
                !isFinite(topPx) ||
                widthPx < 0 ||
                heightPx < 0
              )
                return null;
              return (
                <div
                  key={tetrimino.id}
                  draggable
                  onDragStart={(e) =>
                    handlePlacedTetrominoDragStart(e, tetrimino.id)
                  }
                  className="absolute cursor-grab rounded-md group"
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    width: `${widthPx}px`,
                    height: `${heightPx}px`,
                    zIndex: 20,
                  }}
                >
                  {/* 各テトリミノブロックの描画 */}
                  {tetrimino.blockDetails.map((block: any) => {
                    const blockLeft = (block.x - minX) * CELL_PX_SIZE;
                    const blockTop = (block.y - minY) * CELL_PX_SIZE;
                    if (!isFinite(blockLeft) || !isFinite(blockTop))
                      return null;
                    return (
                      <div
                        key={`${tetrimino.id}-${block.x}-${block.y}`}
                        className="absolute w-9 h-9 rounded-sm box-border"
                        style={{
                          left: `${blockLeft}px`,
                          top: `${blockTop}px`,
                          backgroundColor:
                            TETROMINO_COLORS[
                              tetrimino.type as keyof typeof TETROMINO_COLORS
                            ][block.colorIndex] ?? UI_COLORS.darkBackground,
                          border: "1px solid rgba(255,255,255,0.2)",
                        }}
                      />
                    );
                  })}

                  {/* 回転・削除ボタンのオーバーレイ */}
                  <div className="absolute inset-0 flex items-center justify-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleRotate(tetrimino.id)}
                      className="bg-blue-600 text-white p-1 rounded-full shadow-md hover:bg-blue-700"
                      title="回転"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004 12c0 2.21.894 4.204 2.343 5.657M18 19v-5h-.582m0 0a8.001 8.001 0 01-15.356-2m15.356 2c-.065.311-.083.63-.058.95L18 19z"
                        ></path>
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(tetrimino.id)}
                      className="bg-red-600 text-white p-1 rounded-full shadow-md hover:bg-red-700"
                      title="削除"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        ></path>
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
