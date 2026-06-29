export const GET_PRODUCTS_QUERY = `#graphql
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          description
          descriptionHtml
          handle
          vendor
          productType
          tags
          onlineStoreUrl
          media(first: 25) {
            edges {
              node {
                id
                mediaContentType
                alt
                ... on MediaImage {
                  image {
                    url
                    width
                    height
                  }
                }
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                inventoryItem {
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_SHOP_SETTINGS_QUERY = `#graphql
  query getShopSettings {
    shop {
      name
      primaryDomain {
        url
      }
    }
  }
`;

export const UPDATE_PRODUCT_MUTATION = `#graphql
  mutation updateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const UPDATE_IMAGE_MUTATION = `#graphql
  mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export const UPDATE_VARIANTS_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        sku
        barcode
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_SINGLE_PRODUCT_QUERY = `#graphql
  query getProduct($id: ID!) {
    node(id: $id) {
      ... on Product {
        id
        title
        description
        descriptionHtml
        handle
        vendor
        productType
        tags
        onlineStoreUrl
        media(first: 25) {
          edges {
            node {
              id
              mediaContentType
              alt
              ... on MediaImage {
                image {
                  url
                  width
                  height
                }
              }
            }
          }
        }
        variants(first: 100) {
          edges {
            node {
              id
              title
              sku
              barcode
              price
              compareAtPrice
              inventoryQuantity
              inventoryItem {
                measurement {
                  weight {
                    value
                    unit
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
