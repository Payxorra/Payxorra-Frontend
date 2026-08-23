"use client";

export enum RoundingMode {
  HALF_UP = "HALF_UP",
  DOWN = "DOWN",
  UP = "UP",
}

const MAX_STROOP = BigInt("100000000000000000000"); // 10^20 stroops ~ 10^13 XLM

function pow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}

export function toStroop(amount: string, decimals: number): bigint {
  const negative = amount.startsWith("-");
  const clean = negative ? amount.slice(1) : amount;
  const dot = clean.indexOf(".");
  if (dot === -1) {
    const full = clean + "0".repeat(decimals);
    const trimmed = full.replace(/^0+/, "") || "0";
    const result = BigInt(trimmed);
    return negative ? -result : result;
  }
  const intPart = clean.slice(0, dot);
  let decPart = clean.slice(dot + 1);
  const secondDot = decPart.indexOf(".");
  if (secondDot !== -1) {
    decPart = decPart.slice(0, secondDot);
  }
  const padded = decPart.padEnd(decimals, "0").slice(0, decimals);
  const full = intPart + padded;
  const trimmed = full.replace(/^0+/, "") || "0";
  const result = BigInt(trimmed);
  return negative ? -result : result;
}

export function fromStroop(stroops: bigint, decimals: number): string {
  const divisor = pow10(decimals);
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const intPart = abs / divisor;
  const remainder = abs % divisor;
  const prefix = negative ? "-" : "";
  if (remainder === 0n) return prefix + intPart.toString();
  let decStr = remainder.toString().padStart(decimals, "0");
  decStr = decStr.replace(/0+$/, "");
  return `${prefix}${intPart}.${decStr}`;
}

export function formatStroop(
  stroops: bigint,
  decimals: number,
  locale?: string,
): string {
  const divisor = pow10(decimals);
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const intPart = abs / divisor;
  const remainder = abs % divisor;
  const prefix = negative ? "-" : "";
  const intFormatter = new Intl.NumberFormat(locale, { useGrouping: true });
  let formattedInt: string;
  if (intPart <= BigInt(Number.MAX_SAFE_INTEGER)) {
    formattedInt = intFormatter.format(Number(intPart));
  } else {
    formattedInt = intPart.toString();
  }
  if (remainder === 0n) return prefix + formattedInt;
  let decStr = remainder.toString().padStart(decimals, "0");
  decStr = decStr.replace(/0+$/, "");
  const significant = decStr.length; // eslint-disable-line @typescript-eslint/no-unused-vars
  return prefix + formattedInt + "." + decStr;
}

export function add(a: bigint, b: bigint): bigint {
  const result = a + b;
  if (result > MAX_STROOP || result < -MAX_STROOP) {
    throw new Error("Overflow: addition exceeds maximum allowed stroop amount");
  }
  return result;
}

export function sub(a: bigint, b: bigint): bigint {
  const result = a - b;
  if (result > MAX_STROOP || result < -MAX_STROOP) {
    throw new Error("Overflow: subtraction exceeds maximum allowed stroop amount");
  }
  return result;
}

export function mul(a: bigint, b: bigint): bigint {
  const result = a * b;
  if (result > MAX_STROOP || result < -MAX_STROOP) {
    throw new Error("Overflow: multiplication exceeds maximum allowed stroop amount");
  }
  return result;
}

export function div(
  a: bigint,
  b: bigint,
  rounding: RoundingMode = RoundingMode.HALF_UP,
): bigint {
  if (b === 0n) throw new Error("Division by zero");
  const q = a / b;
  const r = a % b;
  if (r === 0n) return q;
  const absR = r < 0n ? -r : r;
  const absB = b < 0n ? -b : b;
  switch (rounding) {
    case RoundingMode.DOWN:
      return q;
    case RoundingMode.UP:
      return r > 0n ? q + 1n : q - 1n;
    case RoundingMode.HALF_UP:
      if (absR * 2n >= absB) {
        return r > 0n ? q + 1n : q - 1n;
      }
      return q;
    default:
      return q;
  }
}

export function compare(a: bigint, b: bigint): number {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

export function isZero(a: bigint): boolean {
  return a === 0n;
}

export function isNegative(a: bigint): boolean {
  return a < 0n;
}
