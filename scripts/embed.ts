import { embedImageUrl } from "@/lib/embeddings";
import { qdrantClient } from "@/lib/qdrant";

const items = [
  {
    auctionet_id: "5081287",
    image_url:
      "https://images.auctionet.com/uploads/item_5081287_0ddf889b67.jpg",
  },
  {
    auctionet_id: "5081287",
    image_url:
      "https://images.auctionet.com/uploads/item_5081287_aef2ecdffc.jpg",
  },
  {
    auctionet_id: "5081287",
    image_url:
      "https://images.auctionet.com/uploads/item_5081287_c75afeac6e.jpg",
  },
  {
    auctionet_id: "5081287",
    image_url:
      "https://images.auctionet.com/uploads/item_5081287_ff0781c291.jpg",
  },
  {
    auctionet_id: "5081287",
    image_url:
      "https://images.auctionet.com/uploads/item_5081287_14879f7c43.jpg",
  },
  {
    auctionet_id: "5081287",
    image_url:
      "https://images.auctionet.com/uploads/item_5081287_f85fa10bb9.jpg",
  },
];

for (const { auctionet_id, image_url } of items) {
  const vector = await embedImageUrl(image_url);
  await qdrantClient.upsert("images", {
    wait: true,
    points: [
      {
        id: crypto.randomUUID(),
        payload: { auctionet_id },
        vector,
      },
    ],
  });
  console.log(`Embedded ${auctionet_id}`);
}
