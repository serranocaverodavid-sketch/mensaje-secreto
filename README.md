# 🔐 Traductor secreto · Texto ⇄ Romano

Pequeña web para jugar al **juego del mensaje secreto**: convierte texto en números romanos y descífralo de vuelta.

- Cada carácter se sustituye por un número romano (`A → I`, `a → II`, `B → III`, …).
- Los códigos de una palabra se unen con `-` y las palabras se separan con `--` (un doble guion es un espacio).
- El botón ⇄ invierte la dirección de la traducción.
- Dos tablas: **original** (la del documento, con sus huecos) y **mejorada** (completa y sin códigos repetidos).
- Incluye el mensaje secreto de ejemplo y una tabla de referencia con buscador.

Ejemplo: `Hola` → `XV-XXXII-XXIV-II`

## Usar en local

Es HTML, CSS y JavaScript sin dependencias. Basta con servir la carpeta:

```bash
python -m http.server 5173
```

y abrir <http://localhost:5173> (en Windows también sirve `iniciar.bat`).
