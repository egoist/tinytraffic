import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color,box-shadow] outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "btn-emphasis",
        destructive: "btn-emphasis [--btn:var(--destructive)]",
        // Raised: white face, hairline rim, small drop shadow; pressing sinks it.
        outline:
          "bg-card text-foreground shadow-xs ring ring-line hover:bg-accent active:bg-recessed active:shadow-none focus-visible:ring-2 focus-visible:ring-ring data-[expanded]:bg-accent",
        secondary: "bg-recessed text-secondary-foreground ring ring-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        ghost: "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[expanded]:bg-accent",
        link: "text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 gap-1.5 px-3",
        lg: "h-10 px-6",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["class", "variant", "size", "type"]);
  return (
    <button
      type={local.type ?? "button"}
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...rest}
    />
  );
}
