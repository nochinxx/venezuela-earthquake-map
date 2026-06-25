# Metodología y Transparencia — SismoVenezuela

Este documento explica cómo se recopila, consolida y actualiza cada tipo de dato en el mapa.

---

## Fuentes de datos

| Capa | Fuente | Frecuencia de actualización |
|------|--------|----------------------------|
| Reportes (heatmap) | YouTube, Twitter/X, Instagram — búsqueda por palabras clave | Cada 10 minutos |
| Edificios afectados | terremotovenezuela.com (equipo verificador) | Cada 30 minutos |
| Personas desaparecidas | desaparecidosterremotovenezuela.com + venezulatebusca.com | Cada 30 minutos |
| Centros de acopio | Twitter/X + carga manual verificada | Cada 30 minutos |
| Fallecidos / heridos | Fuentes oficiales + medios (carga manual prioritaria) | Cada 30 minutos |
| Deduplicación | Proceso automático (ver abajo) | Cada 60 minutos |

---

## Reportes de redes sociales

Los reportes del heatmap se obtienen buscando palabras clave relacionadas con el terremoto en YouTube, Twitter/X e Instagram. **Son no verificados** — representan lo que la gente publica, no daños confirmados. Un mismo lugar puede aparecer en múltiples reportes.

El nivel de daño (1–5) se infiere del texto del post mediante análisis de palabras clave. No es una evaluación estructural.

---

## Personas desaparecidas

**"Desaparecido" significa pérdida de contacto**, no víctima confirmada. La mayoría son personas reportadas por familiares que no han podido comunicarse tras el sismo, lo que puede deberse a fallas en la red telefónica, evacuación, o simplemente falta de señal.

### Fuentes
- **desaparecidosterremotovenezuela.com** — plataforma de reporte colaborativo
- **venezulatebusca.com** — plataforma independiente de búsqueda de personas

Ambas plataformas reciben reportes del público. Los datos se sincronizan automáticamente cada 30 minutos.

### Deduplicación
Muchas personas aparecen en ambas plataformas. Usamos dos métodos para identificar duplicados:

1. **Coincidencia de teléfono** — si dos registros comparten número de contacto, se marcan como el mismo caso.
2. **Similitud de nombre (Gemma 4)** — un modelo de lenguaje local compara pares de nombres con grafía similar para determinar si son la misma persona. Funciona con variaciones de acentos, errores tipográficos y nombres abreviados.

Los duplicados se excluyen del conteo y del mapa, pero se conservan en la base de datos. **El proceso automático puede cometer errores** — si detectas un caso mal clasificado, puedes reportarlo en GitHub.

### Geocodificación
La ubicación de los marcadores violetas se infiere del campo "última ubicación vista" usando un diccionario de ~80 ciudades y barrios venezolanos. Registros sin ubicación reconocible no aparecen en el mapa pero sí en el panel de búsqueda.

---

## Edificios afectados

Los puntos ámbar provienen exclusivamente del equipo de **terremotovenezuela.com**, que verifica y documenta edificios con daño estructural. Cada registro tiene nivel de daño (total / severo / parcial) y enlaza a la ficha individual con fotos y fuente.

No publicamos edificios sin verificación previa de ese equipo.

---

## Cifras de fallecidos y heridos

Las cifras oficiales se extraen automáticamente de medios y fuentes gubernamentales, pero **una entrada manual tiene prioridad por 24 horas** sobre cualquier extracción automática. Esto evita que titulares con números incorrectos sobreescriban datos verificados.

La fuente de cada cifra se indica con un enlace en la tarjeta de resumen del mapa.

---

## Centros de acopio

Se obtienen vía scraping de Twitter/X y carga manual curada. Cada centro incluye la fuente original. Los datos pueden desactualizarse — siempre verifica con la fuente antes de acudir.

---

## Limitaciones conocidas

- Los reportes de redes sociales pueden incluir contenido duplicado, desactualizado o de baja credibilidad.
- La geocodificación es aproximada (nivel de ciudad/barrio, no dirección exacta).
- La deduplicación automática tiene una tasa de error estimada del 2–5%.
- Los centros de acopio no tienen confirmación de horario actualizado en tiempo real.
- Las cifras de fallecidos e heridos son oficiales y pueden estar subregistradas.

---

## Código abierto

Todo el código fuente está disponible en este repositorio bajo licencia MIT. Los scrapers, el esquema de base de datos y la lógica de deduplicación son auditables públicamente.

Si encontrás un error en los datos o en la metodología, abrí un issue en GitHub.
