import { embedImageUrl } from "@/lib/embeddings";
import { qdrantClient } from "@/lib/qdrant";

const items = [
  {
    auctionet_id: 2719085,
    image_url:
      "https://images.auctionet.com/uploads/item_2719085_fadaedc658.jpg",
  },
];

for (const { auctionet_id, image_url } of items) {
  const vector = await embedImageUrl(image_url, 3072);
  await qdrantClient.upsert("images_3072", {
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
