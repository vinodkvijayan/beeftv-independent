# One-click product main image plug-in (`beeftv-plugin-ecommerce-hero`)

`beeftv-plugin-ecommerce-hero` is a sample plug-in for e-commerce visual creation. It integrates canvas nodes, assistant tools, skills and assistant tool result cards:

- **Canvas Node (`ecommerce-hero`)**: Supports inputting the product name, pasting the product white background image URL or connecting to the upstream image node, selecting the scene style (studio shooting texture / life scene / holiday promotion) and the number of images (1 / 2 / 4 images). Click "Generate Main Image Node" to batch create scene main image nodes on the canvas through `host.ops.call("canvas.nodes.create", ...)`.
- **Assistant Tool (`ecommerce_hero_arrange`)**: Automatically create `ecommerce-hero` nodes and 1~4 downstream `image` scene graph nodes, establish connections, and support direct call to `canvas_generation_propose` to register and pay to generate proposals.
- **Assistant skills (`ecommerce-hero`)**: Guide the creative assistant to disassemble the selling points and scene composition according to the high-conversion e-commerce main image specifications.