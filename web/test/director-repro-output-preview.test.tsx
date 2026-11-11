import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DirectorReproOutputPreview } from "../src/pages/dev/director-repro-output-preview";

test("You can view and download the recently generated reference images and white film videos on the recurrence page.", () => {
    const html = renderToStaticMarkup(<DirectorReproOutputPreview beautyUrl="blob:beauty" clayVideoUrl="blob:clay" />);
    expect(html).toContain('aria-label="Recently generated reference material"');
    expect(html).toContain('src="blob:beauty"');
    expect(html).toContain('src="blob:clay"');
    expect(html).toContain('download="Director\'s desk reference picture.png"');
    expect(html).toContain('download="Director\'s white film video.webm"');
});
