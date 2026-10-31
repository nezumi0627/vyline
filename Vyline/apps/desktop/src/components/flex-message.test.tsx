import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "bun:test";
import { FlexMessageView } from "./flex-message";

test("matches Flex block styling, RTL layout and button sizing", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        direction: "rtl",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              flex: 1,
              gravity: "center",
              action: { type: "uri", uri: "https://example.com" },
            },
          ],
        },
        styles: { body: { backgroundColor: "#123456" } },
      },
    }),
  );

  expect(html).toContain("fxRTL");
  expect(html).toContain("background-color:#123456");
  expect(html).toContain("MdBtn ExBtnL fl1 grvC");
});

test("uses logical spacing for RTL Flex boxes and absolute offsets", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        direction: "rtl",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              position: "absolute",
              offsetStart: "10px",
              paddingStart: "8px",
              paddingEnd: "12px",
              contents: [],
            },
          ],
        },
      },
    }),
  );

  expect(html).toContain("inset-inline-start:10px");
  expect(html).toContain("padding-inline-start:8px");
  expect(html).toContain("padding-inline-end:12px");
});

test("applies component margin on the parent box main axis", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        direction: "rtl",
        body: {
          type: "box",
          layout: "horizontal",
          contents: [{ type: "text", text: "rating", margin: "md" }],
        },
      },
    }),
  );

  expect(html).toContain('margin-inline-start:8px');
});

test("supports percentage widths for Flex images", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        hero: {
          type: "image",
          url: "https://example.com/image.png",
          size: "50%",
          aspectRatio: "2:1",
        },
      },
    }),
  );

  expect(html).toContain('style="width:50%"');
});

test("uses the vertical Flex basis for items that divide remaining height", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          height: "120px",
          contents: [{ type: "box", layout: "vertical", flex: 2, contents: [] }],
        },
      },
    }),
  );

  expect(html).toContain("MdBx vr fl2");
});

test("applies relative offsets to non-box components", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "offset", offsetTop: "10px", offsetStart: "12px" },
          ],
        },
      },
    }),
  );

  expect(html).toContain("position:relative");
  expect(html).toContain("top:10px");
  expect(html).toContain("inset-inline-start:12px");
});

test("renders every carousel bubble in a horizontally scrollable row", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "carousel",
        contents: [
          { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } },
          { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } },
        ],
      },
    }),
  );

  expect(html).toContain('class="vfx LySlider"');
  expect(html).toContain('class="lyInner"');
  expect(html.match(/class="lyItem LyMe"/g)).toHaveLength(2);
  expect(html.match(/class="LyMe"/g)).toHaveLength(2);
});

test("applies line spacing only as additional spacing between wrapped lines", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "text", text: "first\\nsecond", wrap: true, lineSpacing: "20px" }],
        },
      },
    }),
  );

  expect(html).toContain("line-height:calc(1.4em + 20px)");
  expect(html).toContain("margin-block:-10px");
});

test("scales Flex text when its scaling property is enabled", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "text", text: "scaled", size: "lg", scaling: true }],
        },
      },
    }),
  );

  expect(html).toContain("font-size:calc(19px * var(--vy-font-scale, 1))");
});

test("keeps the specified fallback content inside Flex video", () => {
  const html = renderToStaticMarkup(
    createElement(FlexMessageView, {
      container: {
        type: "bubble",
        hero: {
          type: "video",
          url: "https://example.com/video.mp4",
          previewUrl: "https://example.com/preview.jpg",
          aspectRatio: "16:9",
          altContent: {
            type: "image",
            url: "https://example.com/fallback.jpg",
            size: "full",
            aspectRatio: "16:9",
          },
        },
      },
    }),
  );

  expect(html).toContain("<video");
  expect(html).toContain("fallback.jpg");
});
