---
name: ecommerce-hero
description: E-commerce one-click product main image arrangement skill: Based on the product name, white background reference image and selling points, automatically plan multiple high-converting product main images and generate them on the canvas.
---

# One-click product main image (`ecommerce-hero`)

## Applicable scenarios

- Users need to create main images for e-commerce products, home screen scene images for detail pages, studio white background/textured main images, or holiday promotion atmosphere images.
- The user has uploaded the original image of the product or provided the product name and selling points, hoping to quickly produce 1 to 4 main images of the product in different scenes.

## Arrangement steps

1. Refining the product name `productTitle` and 2~4 core visual selling points `sellingPoints` (material, function, applicable group or scene).
2. Call the `ecommerce_hero_arrange` tool:
   - Input `productTitle`, `sellingPoints` and user expected `sceneCount` (1~4 pictures, default 2 pictures).
   - If there is already a product white background reference image on the canvas, you can use `canvas_edge_create` after creation to connect the original product image node to each main image node to be generated as a reference image.
   - If the user requests to publish the picture directly, set `proposeGeneration` to `true`, and the system will register and generate the proposal and submit it to the user for confirmation.
3. Explain to users the scene positioning corresponding to each main image (minimalist studio shots, real life scenes, detailed close-ups, atmospheric posters).