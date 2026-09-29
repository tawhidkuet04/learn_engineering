# Security policy

This repository is a static website. The lessons are built ahead of time and served as plain files: there are no accounts, no user data and no server-side code in production.

## Reporting a vulnerability

Please report security problems privately, through GitHub's [private report form](https://github.com/tawhidkuet04/learn_engineering/security/advisories/new). Only the maintainer can see what you send there. Please don't open a public issue for a vulnerability.

Include what you found, where (a URL or a file), and how to reproduce it. You'll get a reply there, and credit in the fix unless you'd rather stay anonymous.

## Scope

In scope: the site at [learn-engineering.xyz](https://learn-engineering.xyz) and the code in this repository, for example script injection through a lesson page or a URL.

Out of scope: the real servers that `verify/` starts. They run only on 127.0.0.1 on the machine running the tests, and problems in nginx, HAProxy, Redis or PostgreSQL themselves belong with those projects.

## Supported versions

Fixes go to `main`, which is what the live site runs.
