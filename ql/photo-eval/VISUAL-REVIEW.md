# Fixture visual review

Reviewed all 48 reference-0 renders in a contact sheet, plus enlarged representatives of blue/light/dark/multicolor, shadow, cluttered background, ambiguous marker-free view, crop, orientation and unseen-object queries. The corpus is intentionally stylized pottery, not photorealistic captures.

Pair members share glaze and silhouette; central dot/incision placement and sizes distinguish positives. Pale bodies retain white/cream tones, dark bodies have speckling, multicolor bodies carry colored bands. Ambiguous views omit pair-specific identity evidence and therefore accept both family members. No labels derive from retrieval output.

During fixture QA, the initial crop transform was found to be merely a tighter framing. Before baseline freeze it was changed to scale 1.6 and translate (-45,-60), producing real edge clipping while retaining central identity marks. Angle views change rim projection (ellipse depth), rotation and visible geometry in a fresh procedural render; these are stylized alternate views, not physically validated 3D reconstructions. The final corpus was then regenerated and the entire benchmark rerun.

Limits: all objects are bowl/cup-like procedural silhouettes with near-duplicate partners. Central identity marks can favor image-structure matching differently from unmarked real pottery. Ambiguous pair views share geometry and may be byte-identical; correlated query variants must not be presented as independent real-world evidence. Additional consented test-owned photographs and more varied shapes belong in a later benchmark expansion, not tuning this baseline.
