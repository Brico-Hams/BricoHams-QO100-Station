[ES](../es/README.md) · [EN](../en/README.md) · [FR](../fr/README.md) · [PT](../pt/README.md)

<p align="center">
  <a href="https://bricohams.org"><img src="../../../branding/bricohams_horizontal.png" alt="BricoHams" width="360"></a>
</p>

# Radio logicielle (SDR) pour radioamateurs : de la théorie à la station QO-100

**BricoHams** · *Radioamateurisme · Faites-le vous-même* · <https://bricohams.org>

- **Auteurs :** Anatol EA5KAO, Diego EA5JEF et Pedro Roca Molina.
- **Version :** 1.0
- **Langue maître : espagnol (les traductions en dérivent).**
- **Licence du texte et des figures :** [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr). Le code du dépôt (`src/`, `services/`, `plugins/`) est distribué sous **GPL-3.0-or-later** (voir [`NOTICE.md`](../../../NOTICE.md)).

Ce manuel est une œuvre originale. Il explique la radio logicielle à partir d'exemples réels de la bande étroite de QO-100 et du code de cette station. Les livres et projets tiers ne sont cités que comme lectures recommandées ; aucune marque, entreprise ou projet cité ne soutient BricoHams ni ce manuel (il n'y a ni parrainage ni caution de tiers).

## Comment utiliser ce manuel

Chaque chapitre comporte : des objectifs, une explication avec des exemples numériques QO-100, au moins une figure, un encadré **« Comment BricoHams le fait »** avec des liens vers de vrais fichiers du dépôt, des exercices corrigés et une ligne **« Lecture recommandée »**. Les travaux pratiques du [chapitre 12](12-practicas.md) s'exécutent avec Node 24, sans matériel ni réseau.

Les figures 23 à 26 (BER théorique, capacité de Shannon, préfixe cyclique OFDM, cosinus surélevé) sont calculées par un script. Pour les régénérer : `node docs/manual/figures/generate-charts.mjs`.

## Sommaire

| Chap. | Fichier | Thème |
|---|---|---|
| 0 | [Prologue](00-prologo.md) | À qui il s'adresse et comment le lire |
| 1 | [Qu'est-ce qu'une SDR ?](01-que-es-sdr.md) | Architecture générale et chaîne QO-100 |
| 2 | [Signaux et systèmes](02-senales-y-sistemas.md) | Échantillonnage, Nyquist, repliement, I/Q, FFT, fenêtres, décimation |
| 3 | [Bruit et probabilités](03-ruido-y-probabilidad.md) | Bruit thermique, SNR, Eb/N0, facteur de bruit |
| 4 | [Modulation numérique](04-modulacion-digital.md) | FSK, PSK, FT8, FT4, CW, mise en forme des impulsions |
| 5 | [Matériel SDR](05-hardware-sdr.md) | FI nulle, CAN, fuite de l'oscillateur, référence d'horloge |
| 6 | [Synchronisation temporelle](06-sincronizacion-de-tiempo.md) | Symboles, créneaux de 15 s, UTC et NTP |
| 7 | [Synchronisation de porteuse](07-sincronizacion-de-portadora.md) | Décalage de fréquence et balise comme référence |
| 8 | [Trames et codage](08-tramas-y-codificacion.md) | Costas, CRC-14, LDPC(174,91) |
| 9 | [Canal et égalisation](09-canal-y-ecualizacion.md) | Canal satellite, Doppler, trajets multiples, CAG |
| 10 | [OFDM](10-ofdm.md) | Concept et pourquoi QO-100 NB ne l'utilise pas |
| 11 | [Applications sur QO-100](11-aplicaciones-qo100.md) | La station BricoHams complète |
| 12 | [Travaux pratiques](12-practicas.md) | Laboratoires avec le code du dépôt |
| — | [Glossaire](glosario.md) | Termes et sigles |
| — | [Bibliographie](bibliografia.md) | Lectures et documentation |

## Figures

Les figures se trouvent dans [`../figures/`](../figures/) (`fig-NN-<thème>.svg`) ; ce sont des SVG écrits à la main ou générés par script, avec titre et description accessibles, et elles utilisent la palette BricoHams (bleu marine `#12263f`, orange `#e8871e`, gris `#5b6b7b`). Le texte intégré aux figures est en espagnol ; une légende traduite figure sous chaque figure.
