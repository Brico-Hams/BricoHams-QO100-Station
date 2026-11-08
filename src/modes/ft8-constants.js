// Protocol constants for FT8 and FT4.
// Values from ft8_lib (https://github.com/kgoba/ft8_lib), ft8/constants.c and ft8/constants.h.
// Copyright (c) 2018 Karlis Goba, MIT License (see NOTICE.md).

export const FT8_COSTAS = Object.freeze([3, 1, 4, 0, 6, 5, 2]);
export const FT4_COSTAS = Object.freeze([[0, 1, 3, 2], [1, 0, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1]].map((r) => Object.freeze(r)));
export const FT8_GRAY = Object.freeze([0, 1, 3, 2, 5, 6, 4, 7]);
export const FT4_GRAY = Object.freeze([0, 1, 3, 2]);
/** FT4 whitens the payload with this sequence before CRC and FEC. */
export const FT4_XOR = Object.freeze([0x4a, 0x5e, 0x89, 0xb4, 0xb0, 0x8a, 0x79, 0x55, 0xbe, 0x28]);

/**
 * Protocol descriptions.
 * `syncStart(m)` is the index of the first symbol of the m-th Costas block; `costas(m)` its tone pattern.
 */
export const PROTOCOLS = Object.freeze({
  FT8: Object.freeze({
    name: 'FT8',
    numSymbols: 79,
    numData: 58,
    bitsPerSymbol: 3,
    numTones: 8,
    numSync: 3,
    lengthSync: 7,
    syncOffset: 36,
    firstSync: 0,
    symbolPeriod: 0.16,
    slotSeconds: 15,
    decodeAtSeconds: 14.5,
    gaussianBt: 2.0,
    nominalStartSeconds: 0.5,
    gray: FT8_GRAY,
    costas: () => FT8_COSTAS,
    dataSymbol: (k) => k + (k < 29 ? 7 : 14),
  }),
  FT4: Object.freeze({
    name: 'FT4',
    numSymbols: 105,
    numData: 87,
    bitsPerSymbol: 2,
    numTones: 4,
    numSync: 4,
    lengthSync: 4,
    syncOffset: 33,
    firstSync: 1,
    symbolPeriod: 0.048,
    slotSeconds: 7.5,
    decodeAtSeconds: 7.0,
    gaussianBt: 1.0,
    nominalStartSeconds: 0.5,
    gray: FT4_GRAY,
    costas: (m) => FT4_COSTAS[m],
    dataSymbol: (k) => k + (k < 29 ? 5 : k < 58 ? 9 : 13),
  }),
});

export const SAMPLE_RATE = 12000;
