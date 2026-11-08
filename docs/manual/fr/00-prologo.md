[ES](../es/00-prologo.md) · [EN](../en/00-prologo.md) · [FR](../fr/00-prologo.md) · [PT](../pt/00-prologo.md)

# Prologue

![Blocs d'une SDR](../figures/fig-01-bloques-sdr.svg)

*Figure 1 : Blocs d'une SDR.*

Il y a encore peu d'années, écouter le satellite géostationnaire QO-100 exigeait une chaîne d'équipements coûteux et fermés. Aujourd'hui, une clé SDR de quelques dizaines d'euros, un LNB et une parabole TV permettent de voir à l'écran toute la bande étroite de 500 kHz et de décoder des dizaines de communications à la fois. Ce qui a changé, ce n'est pas l'antenne : c'est que **la radio est passée du circuit à l'algorithme**.

Ce manuel veut vous faire comprendre cet algorithme assez bien pour dépanner votre station, choisir votre matériel en connaissance de cause et lire le code de BricoHams sans crainte.

## À qui il s'adresse

- Les radioamateurs ayant des bases d'électronique ou l'envie de les acquérir.
- Les bricoleurs (« faites-le vous-même ») qui montent parabole, LNB, hélice et SDR et veulent savoir *pourquoi* ça marche.
- Les étudiants qui cherchent des exemples de DSP sur un cas réel et reproductible.

Il n'est pas nécessaire de savoir programmer, mais les travaux pratiques du [chapitre 12](12-practicas.md) utilisent Node.js (version 24) et sont plus profitables si vous osez modifier les exemples.

## Organisation

Les chapitres 2 à 10 suivent le chemin du signal, de l'air jusqu'au message décodé : échantillonnage, bruit, modulation, matériel, synchronisation temporelle et de porteuse, codage, canal et OFDM. Le chapitre 11 rassemble le tout dans la station BricoHams et le 12 propose des laboratoires.

Chaque chapitre se termine par des exercices corrigés. Les chiffres de QO-100 (fréquences, transposition du satellite, FI du LNB) proviennent du code du dépôt, dans [`src/modes/frequencies.js`](../../../src/modes/frequencies.js) ; les paramètres de FT8 et FT4, de [`src/modes/ft8-constants.js`](../../../src/modes/ft8-constants.js).

## Conventions

- Virgule décimale dans le texte ; point dans le code.
- Les « dB » sont des rapports de puissance (10·log₁₀) sauf indication contraire ; dBm, dBW et dBFS précisent leur référence.
- Les valeurs marquées *illustratives* sont des hypothèses pour s'exercer, pas des mesures de votre station.

## Honnêteté sur les sources

Ce texte est original : il explique les concepts avec des mots et des exemples propres. Lorsqu'un livre traite un sujet plus en profondeur, nous l'indiquons comme lecture recommandée (par chapitre, sans reproduire son contenu). Vérifiez toujours les paramètres opérationnels (fréquences de balise, limites de puissance, plan de bandes) auprès des sources officielles d'AMSAT-DL et de votre administration.

Lecture recommandée : Collins et al., Software-Defined Radio for Engineers, ch. 1
