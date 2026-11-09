# References

Index of `docs/references/`. These folders hold material BricoHams was built from or checked against. Third-party copyrighted works are **not** redistributed: only the original, short or own-words documents are committed, and the rest stays on the maintainer's disk and is listed in `.gitignore`. Licence and attribution summary for the whole project: [NOTICE.md](../../NOTICE.md).

| Folder | What it contains | Source | Licence / attribution | Committed? |
| --- | --- | --- | --- | --- |
| [`ea5en/`](ea5en/README.md) | `README.md` (who EA5EN is, what was integrated and where, how to cite), `image-pages.md` (description of the course slides that are only images), `urls.txt`, `receiver-status.json` (public status of his OpenWebRX+ receiver) | *Curso Iniciación QO-100* and the public OpenWebRX+ receiver of Mateo EA5EN (EA5RCZ Radioclub Región de Murcia) | The course is third-party work with all rights reserved; it is summarised in our own words in `docs/help/` with citations ("Fuente: Curso Iniciación QO-100, EA5EN Mateo (diapositiva N)"). The receiver is only linked | README, `image-pages.md`, `urls.txt`, `receiver-status.json`: yes. `qo100-course-extract.txt` (text extracted from the copyrighted PDF) and the PDF itself: **local only, gitignored** |
| [`sdr-software/`](sdr-software/comparison.md) | `comparison.md`: comparison of BricoHams with established SDR programs, used to choose features ([ADR 0017](../adr/0017-comparison-driven-scope.md)) | Our own text, written from memory without internet access; doubtful claims are marked "(verificar)" | Own work, GPL-3.0-or-later like the rest. Proprietary programs (SDRuno, HDSDR, SDR#, SDR Console) are used for ideas only: no code, UI, icons or text copied | Yes |
| [`sdr4engineers/`](sdr4engineers/README.md) | `README.md`: bibliographic entry and chapter titles of *Software-Defined Radio for Engineers* (Collins, Getz, Pu, Wyglinski, Artech House 2018, ISBN 978-1-63081-457-1). `guia-estudio-sdr-lumo.md`: a personal study guide that closely follows the book | The book, © 2018 the authors, distributed by Analog Devices | The book is not in the repository and is not reproduced or translated; the BricoHams manual (`docs/manual/`) is an original work that cites it as recommended reading | README: yes. `guia-estudio-sdr-lumo.md`: **local only, gitignored** (follows a copyrighted book too closely) |
| [`sdrangel-swagger/`](sdrangel-swagger/README.md) | Unmodified copy of the SDRangel REST API definitions BricoHams uses: `swagger.yaml`, `include/*.yaml`, and a few C++ headers/sources in `source/` (enum values, spectrum WebSocket frame layout) | [f4exb/sdrangel](https://github.com/f4exb/sdrangel) `swagger/sdrangel/api/swagger/` and the settings headers, pinned to commit `596a3ac9389d50690b8e08eceb24e8e580cff10a` (retrieved 2026-11-08) | © Edouard Griffiths F4EXB and contributors, GPL-3.0 (compatible with this project's GPL-3.0-or-later). Files kept verbatim so they can be diffed against upstream | Yes. Used at test time by the strict mock ([ADR 0022](../adr/0022-sdrangel-api-alignment.md)); refresh procedure in [DEVELOPER.md](../DEVELOPER.md#refreshing-the-sdrangel-reference-copy) |

## What stays local

`.gitignore` excludes:

- `docs/references/ea5en/qo100-course-extract.txt`: text extracted from the copyrighted course.
- `docs/references/sdr4engineers/guia-estudio-sdr-lumo.md`: study guide that follows a copyrighted book.
- `*.env`, `data/` (runtime data, secrets), `node_modules`, `dist`, `graphify-out/cache`.

Never commit PDFs, slide images or book text. If you add a new reference: put a `README.md` in its folder with the source, the licence or "all rights reserved", and how it may be cited; summarise in your own words; and add anything copyrighted to `.gitignore` in the same change.

## Thanks

Thanks to **Mateo EA5EN** for sharing his *Curso Iniciación QO-100* and for keeping his OpenWebRX+ receiver open: it serves the community as an independent reference of frequency and reception. Thanks also to F4EXB and the SDRangel contributors, whose open definitions make the strict API checks possible.

---
bricohams.org · Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina · [Brico-Hams/BricoHams-QO100-Station](https://github.com/Brico-Hams/BricoHams-QO100-Station)
