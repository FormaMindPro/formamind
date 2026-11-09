# Цели

Карта целей проекта находится в `project/ops/ROADMAP.md`; здесь располагается сегмент каждой отдельной цели — по одному каталогу на цель.

## Формат

```
goals/
  goal-<code>/       главная цель вида — девять, по одной на каждый эпик (analytics, structure, protocol, resources, balance, discussion, channels, competencies, results)
    GOAL.md
  goal-NN-<name>/    подцель, сквозная нумерация по всем видам; вид задаётся картой ROADMAP.md
    GOAL.md          образ результата, критерий, круги, вердикты
```

`NN` — порядковый номер, `<name>` — краткое имя латиницей. Создаётся узлом `Intent` на шаге 11 подготовки (`project/config/SETUP.md`) либо при открытии новой цели из `ROADMAP.md`.

Документация по итогам цели для человека ведётся не здесь, а в `project/docs/goal-NN-<name>/` (тот же номер и имя каталога — правило переноса, `manual/ru/03-protocol/SCHEME.md`, разд. 6).
