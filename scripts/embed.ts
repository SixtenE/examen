import { embedImageUrl } from "@/lib/embeddings";
import { qdrantClient } from "@/lib/qdrant";

const items = [
  {
    auctionet_id: 2719085,
    image_url:
      "https://images.auctionet.com/uploads/item_2719085_fadaedc658.jpg",
  },
  {
    auctionet_id: 2719085,
    image_url:
      "https://images.auctionet.com/uploads/item_2719085_9a8693389a.jpg",
  },
  {
    auctionet_id: 2719085,
    image_url:
      "https://images.auctionet.com/uploads/item_2719085_6167cacf6a.jpg",
  },
  {
    auctionet_id: 2719085,
    image_url:
      "https://images.auctionet.com/uploads/item_2719085_b6f2348739.jpg",
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
