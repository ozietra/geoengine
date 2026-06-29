declare module "*.css";

// Type definitions for Shopify App Design System Web Components.
// These are custom elements (s-* prefix) that accept standard HTML attributes
// plus component-specific props (heading, slot, etc.). We use a permissive but
// safe base type that allows arbitrary props while still providing autocompletion
// for common attributes like className, style, and slot.
type ShopifyElementProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement> & {
    slot?: string;
    heading?: string;
    href?: string;
  },
  HTMLElement
>;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': ShopifyElementProps;
      's-link': ShopifyElementProps;
      's-page': ShopifyElementProps;
      's-section': ShopifyElementProps;
      's-button': ShopifyElementProps;
      's-text-field': ShopifyElementProps;
      's-box': ShopifyElementProps;
      's-stack': ShopifyElementProps;
      's-heading': ShopifyElementProps;
      's-unordered-list': ShopifyElementProps;
      's-list-item': ShopifyElementProps;
      's-text': ShopifyElementProps;
      's-paragraph': ShopifyElementProps;
    }
  }
}
export {};
